import { ProfileTooLong, TooManyProfiles } from "@gousset/core";
import type { ImportProfileEntry } from "@gousset/core";
import { importProfile } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";
import { Effect } from "effect";

import { addUser } from "../src/auth";
import { importsOn } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #19: a user's CSV profiles, kept, shared as files and chosen by the import's job, on the
// worker's database, through `@gousset/core` as the import screen and the job reach it. The
// accounts and profiles belong to a user of this file's own.

/** How a profile reads a file: `@gousset/import`'s `CsvProfile`, as core lists it. */
type CsvProfile = NonNullable<ImportProfileEntry["definition"]>;

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const importer = await addUser(app.baseURL, user, {
    name: "Charlie Example",
    email: `charlie.profiles.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-charlie-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(importer.email);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, for one that counts or orders every profile the user keeps. */
async function ownerOfItsOwn(
  baseURL: string,
  admin: Parameters<typeof addUser>[1],
  slot: number,
  name: string,
): Promise<string> {
  const added = await addUser(baseURL, admin, {
    name: `${name} Example`,
    email: `${name.toLowerCase()}.profiles.worker${String(slot)}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-${name.toLowerCase()}-password-${String(slot)}`,
  });

  return data.ownerOf(added.email);
}

/** How the invented pipe exports below read: ISO days, one signed amount, the label last. */
const pipeProfile: CsvProfile = {
  version: 1,
  separator: "|",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "YYYY-MM-DD",
  decimalMark: ".",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "signed", column: 2 },
    label: 3,
    memo: null,
    bankId: null,
    currency: null,
  },
};

/** An invented export with the header `Day|Money|What`. */
const pipeExport = (fileName: string, day: string) => ({
  fileName,
  contents: `Day|Money|What\n${day}|-12.50|EXAMPLE BAKERY\n${day}|-30.00|EXAMPLE BOOKSHOP\n`,
});

/**
 * An invented French export whose days are all the 12th or before: detection cannot tell the day
 * from the month. With the shipped French header, a shipped profile reads it; with another, the
 * import waits for the user.
 */
const frenchExport = (fileName: string, header: string) => ({
  fileName,
  bytes: encodeWindows1252(
    [
      "Relevé de compte",
      "Compte courant",
      "Période du 01/12/2026 au 12/12/2026",
      header,
      '01/12/2026;01/12/2026;"CB MARCHÉ DES HALLES";18,40;',
      '03/12/2026;03/12/2026;"VIR SEPA DOMINIQUE EXEMPLE";;75,00',
      "",
    ].join("\r\n"),
  ),
});

const FRENCH_HEADER = "Date;Date de valeur;Libellé;Débit;Crédit";

const saved = (entry: ImportProfileEntry) => {
  if (entry.source !== "stored") {
    throw new Error("A saved profile is the user's own.");
  }

  return entry;
};

test("a profile saved from a preview reads the next file with its header, and the import says so", async () => {
  const accountId = await imports.createAccount(owner, "Pipe account");

  const profile = saved(
    await imports.withProfiles((profiles) =>
      profiles.save(owner, {
        name: "  Pipe export  ",
        institution: "Example Credit Union",
        definition: pipeProfile,
        header: "day;money;what",
      }),
    ),
  );

  expect(profile.name).toBe("Pipe export");

  const done = await imports.importFile(owner, accountId, pipeExport("pipe.csv", "2026-12-04"));

  expect(done).toMatchObject({ status: "done", linesRead: 2, linesAdded: 2 });
  expect(await imports.profileOf(owner, done.id)).toEqual({
    profileId: profile.id,
    shippedProfile: null,
  });

  const fit = await imports.withProfiles((profiles) => profiles.forImport(owner, done.id));

  expect(fit.used).toMatchObject({ source: "stored", id: profile.id });
  expect(fit.fitting).toContainEqual({
    profile: expect.objectContaining({ id: profile.id }),
    by: "header",
  });
});

test("a shipped profile reads a file in its style, the user's own first when it has the header", async () => {
  const accountId = await imports.createAccount(owner, "French account");
  const shipped = await imports.importFile(owner, accountId, frenchExport("a.csv", FRENCH_HEADER));

  expect(shipped).toMatchObject({ status: "done", linesAdded: 2 });
  expect(await imports.profileOf(owner, shipped.id)).toEqual({
    profileId: null,
    shippedProfile: "fr-debit-credit",
  });

  const french = await imports.withProfiles((profiles) =>
    profiles.show(owner, { kind: "shipped", key: "fr-debit-credit" }),
  );

  const own = saved(
    await imports.withProfiles((profiles) =>
      profiles.save(owner, {
        name: "My French bank",
        institution: null,
        definition: french.definition ?? pipeProfile,
        header: french.header,
      }),
    ),
  );

  const again = await imports.importFile(owner, accountId, frenchExport("b.csv", FRENCH_HEADER));

  expect(again).toMatchObject({ status: "done", linesDuplicate: 2 });
  expect(await imports.profileOf(owner, again.id)).toEqual({
    profileId: own.id,
    shippedProfile: null,
  });

  await imports.withProfiles((profiles) => profiles.remove(owner, own.id));
});

test("a file no profile knows is read as detection proposes, with no profile recorded", async () => {
  const accountId = await imports.createAccount(owner, "Detected account");

  const done = await imports.importFile(owner, accountId, {
    fileName: "detected.csv",
    contents: "Booking date;Label;Amount\n2026-12-14;EXAMPLE GROCER;-12,40\n",
  });

  expect(done).toMatchObject({ status: "done", linesAdded: 1 });
  expect(await imports.profileOf(owner, done.id)).toEqual({
    profileId: null,
    shippedProfile: null,
  });
});

test("resuming a waiting import with a shipped key or a stored id reads it with that profile", async () => {
  const accountId = await imports.createAccount(owner, "Resumed account");
  const header = "Date;Valeur;Libellé;Débit;Crédit";

  const waitingFor = async (fileName: string) => {
    const { started } = await imports.keep(owner, accountId, frenchExport(fileName, header));

    await imports.run(owner, started.id);

    const waiting = await imports.show(owner, started.id);

    expect(waiting).toMatchObject({ status: "waiting", waitingFor: "profile" });

    return waiting.id;
  };

  const first = await waitingFor("first.csv");

  await imports.resumeWith(owner, first, {
    accountId: null,
    csvProfile: null,
    profile: { kind: "shipped", key: "fr-debit-credit" },
  });
  await imports.run(owner, first);

  expect(await imports.show(owner, first)).toMatchObject({ status: "done", linesAdded: 2 });
  expect(await imports.profileOf(owner, first)).toEqual({
    profileId: null,
    shippedProfile: "fr-debit-credit",
  });

  const own = saved(
    await imports.withProfiles((profiles) =>
      profiles.importFile(owner, {
        name: "Shared French profile",
        institution: null,
        content: JSON.stringify(frenchDefinition()),
      }),
    ),
  );

  const second = await waitingFor("second.csv");

  await imports.resumeWith(owner, second, {
    accountId: null,
    csvProfile: null,
    profile: { kind: "stored", id: own.id },
  });
  await imports.run(owner, second);

  expect(await imports.show(owner, second)).toMatchObject({ status: "done", linesDuplicate: 2 });
  expect(await imports.profileOf(owner, second)).toEqual({
    profileId: own.id,
    shippedProfile: null,
  });

  // A profile with no header fits the file by a test read of its top.
  const fit = await imports.withProfiles((profiles) => profiles.forImport(owner, second));

  expect(fit.fitting).toContainEqual({
    profile: expect.objectContaining({ id: own.id }),
    by: "test-read",
  });

  await imports.withProfiles((profiles) => profiles.remove(owner, own.id));
});

/** The French style's definition, as shipped. */
function frenchDefinition(): CsvProfile {
  return {
    version: 1,
    separator: ";",
    encoding: "windows-1252",
    skipRows: 3,
    headerRow: true,
    dateFormat: "DD/MM/YYYY",
    decimalMark: ",",
    columns: {
      bookedOn: 1,
      valueOn: 2,
      amount: { kind: "debit-credit", debit: 4, credit: 5 },
      label: 3,
      memo: null,
      bankId: null,
      currency: null,
    },
  };
}

test("a profile is listed, renamed, exported, imported back and deleted", async () => {
  const profile = saved(
    await imports.withProfiles((profiles) =>
      profiles.save(owner, {
        name: "To share",
        institution: "Example Savings Bank",
        definition: pipeProfile,
        header: null,
      }),
    ),
  );

  const renamed = await imports.withProfiles((profiles) =>
    profiles.rename(owner, profile.id, "Shared pipe export"),
  );

  expect(renamed.name).toBe("Shared pipe export");

  const file = await imports.withProfiles((profiles) =>
    profiles.exportFile(owner, { kind: "stored", id: profile.id }),
  );

  expect(file.fileName).toBe("shared-pipe-export.gousset-profile.json");
  expect(JSON.parse(file.content)).toEqual(pipeProfile);

  const copy = saved(
    await imports.withProfiles((profiles) =>
      profiles.importFile(owner, { name: "A copy", institution: null, content: file.content }),
    ),
  );

  expect(copy).toMatchObject({ definition: pipeProfile, header: null, institution: null });

  const listed = await imports.withProfiles((profiles) => profiles.list(owner));
  const names = listed.map((entry) => `${entry.source} ${entry.name}`);

  expect(names).toEqual(expect.arrayContaining(["stored A copy", "stored Shared pipe export"]));
  // The user's first, by name, then the shipped ones.
  expect(names.indexOf("stored Shared pipe export")).toBeLessThan(
    names.indexOf("shipped French style: debit and credit columns"),
  );

  const refusedFile = await imports.withProfiles((profiles) =>
    Effect.flip(
      profiles.importFile(owner, {
        name: "Wrong",
        institution: null,
        content: JSON.stringify({ ...pipeProfile, separator: "#" }),
      }),
    ),
  );

  expect(refusedFile._tag).toBe("InvalidProfileFile");

  const refusedName = await imports.withProfiles((profiles) =>
    Effect.flip(profiles.rename(owner, copy.id, "   ")),
  );

  expect(refusedName._tag).toBe("ProfileNameMissing");

  for (const id of [profile.id, copy.id]) {
    await imports.withProfiles((profiles) => profiles.remove(owner, id));
  }

  const gone = await imports.withProfiles((profiles) =>
    Effect.flip(profiles.show(owner, { kind: "stored", id: profile.id })),
  );

  expect(gone._tag).toBe("ProfileNotFound");
});

test("a user keeps fifty profiles at most: one more is refused, saved or imported", async ({
  app,
  user,
}) => {
  const own = await ownerOfItsOwn(app.baseURL, user, app.slot, "Frankie");

  await data.asUser(own, (transaction) =>
    transaction.insert(importProfile).values(
      Array.from({ length: 50 }, (_, n) => ({
        userId: own,
        name: `Kept profile ${String(n + 1)}`,
        definition: pipeProfile,
      })),
    ),
  );

  const draft = { name: "One more", institution: null, definition: pipeProfile, header: null };

  const refusedSave = await imports.withProfiles((profiles) =>
    Effect.flip(profiles.save(own, draft)),
  );

  expect(refusedSave).toEqual(new TooManyProfiles({ limit: 50 }));

  const refusedImport = await imports.withProfiles((profiles) =>
    Effect.flip(
      profiles.importFile(own, {
        name: "One more",
        institution: null,
        content: JSON.stringify(pipeProfile),
      }),
    ),
  );

  expect(refusedImport).toEqual(new TooManyProfiles({ limit: 50 }));

  const [first] = await imports.withProfiles((profiles) => profiles.list(own));

  if (first?.source !== "stored") {
    throw new Error("The user's profiles come first.");
  }

  await imports.withProfiles((profiles) => profiles.remove(own, first.id));

  expect(await imports.withProfiles((profiles) => profiles.save(own, draft))).toMatchObject({
    name: "One more",
  });
});

test("a profile's name, institution, header and shared file are refused past their length", async () => {
  const draft = { name: "Long", institution: null, definition: pipeProfile, header: null };

  const refused = await imports.withProfiles((profiles) =>
    Effect.all([
      Effect.flip(profiles.save(owner, { ...draft, name: "n".repeat(101) })),
      Effect.flip(profiles.save(owner, { ...draft, institution: "i".repeat(101) })),
      Effect.flip(profiles.save(owner, { ...draft, header: "h".repeat(10_001) })),
      Effect.flip(
        profiles.importFile(owner, {
          name: "Long file",
          institution: null,
          content: `${JSON.stringify(pipeProfile)}${" ".repeat(64 * 1024)}`,
        }),
      ),
    ]),
  );

  expect(refused).toEqual([
    new ProfileTooLong({ field: "name", limit: 100 }),
    new ProfileTooLong({ field: "institution", limit: 100 }),
    new ProfileTooLong({ field: "header", limit: 10_000 }),
    new ProfileTooLong({ field: "file", limit: 65_536 }),
  ]);

  const kept = saved(
    await imports.withProfiles((profiles) =>
      profiles.save(owner, { ...draft, name: "n".repeat(100) }),
    ),
  );

  const renamed = await imports.withProfiles((profiles) =>
    Effect.flip(profiles.rename(owner, kept.id, "r".repeat(101))),
  );

  expect(renamed).toEqual(new ProfileTooLong({ field: "name", limit: 100 }));

  await imports.withProfiles((profiles) => profiles.remove(owner, kept.id));
});

test("a stored definition that no longer reads is listed as such, and refused to resume with", async () => {
  const [broken] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(importProfile)
      .values({ userId: owner, name: "Broken export", definition: { version: 1 } })
      .returning({ id: importProfile.id }),
  );

  if (broken === undefined) {
    throw new Error("The broken profile was not inserted.");
  }

  const listed = await imports.withProfiles((profiles) => profiles.list(owner));

  expect(listed).toContainEqual(
    expect.objectContaining({ source: "stored", id: broken.id, definition: null }),
  );

  const accountId = await imports.createAccount(owner, "Broken profile account");

  const { started } = await imports.keep(
    owner,
    accountId,
    frenchExport("third.csv", "Date;Valeur;Libellé;Débit;Crédit"),
  );

  await imports.run(owner, started.id);

  const refused = await imports.withImports((service) =>
    Effect.flip(
      service.resume(owner, started.id, {
        accountId: null,
        csvProfile: null,
        profile: { kind: "stored", id: broken.id },
      }),
    ),
  );

  expect(refused._tag).toBe("ProfileUnreadable");

  await imports.withProfiles((profiles) => profiles.remove(owner, broken.id));
});
