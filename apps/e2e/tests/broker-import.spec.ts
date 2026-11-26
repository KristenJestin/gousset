import { readFile } from "node:fs/promises";

import {
  DatabaseAccountStore,
  Today,
  investmentAccounts,
  investmentOperations,
  investmentsLayer,
  isinCheckDigit,
} from "@gousset/core";
import type { AccountStore, Investments } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { FORTUNEO_HEADER, fortuneoExport } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { importsOn } from "../src/imports";
import { addUser, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 2: a broker's export of operations imported into an investment account, through
// the import's job on the worker's database, as the upload runs it. Gousset ships no broker's
// profile: the user imports the library's Fortuneo profile file (`packages/import/profiles/`)
// through the profile import, then reads the export with it. The Fortuneo file is invented, its
// header the library's guess, and goes into the made-up PEA (`@gousset/fixture`, "Northbank PEA").
// Every amount and ISIN is invented; the ISINs are in the country code XX, which no country has.
// Each test has a user of its own.

const TODAY = "2026-11-30";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** An invented ISIN: `XX`, nine letters or digits, and its check digit. */
const isin = (rest: string) => `XX${rest}${String(isinCheckDigit(`XX${rest}`))}`;

const FUND = isin("FOR000001");

/** Runs the investments' reads on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Investments | AccountStore | UserData>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(investmentsLayer, DatabaseAccountStore).pipe(Layer.provideMerge(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** The library's Fortuneo profile file, as a user downloads it from the repository. */
const LIBRARY_FILE = new URL(
  "../../../packages/import/profiles/operations/fortuneo-operations.json",
  import.meta.url,
);

/** The library's Fortuneo profile, imported through the profile import as a shared file. */
async function libraryProfile(owner: string): Promise<string> {
  const content = await readFile(LIBRARY_FILE, "utf8");

  const saved = await imports.withProfiles((service) =>
    service.importFile(owner, { name: "Fortuneo (library)", institution: "Fortuneo", content }),
  );

  expect(saved).toMatchObject({ source: "stored", kind: "operations", header: null });

  return saved.source === "stored" ? saved.id : "";
}

/**
 * An invented Fortuneo export, under the header the library's profile guesses: a deposit, two
 * purchases, a dividend, a sale and a custody fee, written with the words of its `Opération`
 * column, in Windows-1252 with semicolons.
 */
const fortuneoFile = () => ({
  fileName: "fortuneo-2026-11.csv",
  bytes: fortuneoExport(
    [
      ["02/11/2026", "Versement espèces", "VIREMENT", "", "", "", "", "", "600,00", "EUR"],
      [
        "03/11/2026",
        "Achat Comptant",
        "FORTUNE WORLD ETF",
        FUND,
        "10",
        "25,10",
        "",
        "1,95",
        "-252,95",
        "EUR",
      ],
      [
        "05/11/2026",
        "Achat Comptant",
        "FORTUNE WORLD ETF",
        FUND,
        "4,5",
        "26,00",
        "",
        "0,99",
        "-117,99",
        "EUR",
      ],
      [
        "16/11/2026",
        "Encaissement dividende",
        "FORTUNE WORLD ETF",
        FUND,
        "",
        "",
        "",
        "0,45",
        "2,55",
        "EUR",
      ],
      [
        "20/11/2026",
        "Vente Comptant",
        "FORTUNE WORLD ETF",
        FUND,
        "2",
        "27,00",
        "",
        "0,99",
        "53,01",
        "EUR",
      ],
      ["28/11/2026", "Droits de garde", "DROITS DE GARDE", "", "", "", "", "", "-3,00", "EUR"],
    ],
    FORTUNEO_HEADER,
  ),
});

/**
 * Keeps the file for the account and reads it with the user's profile, as the import screen does
 * when the user chooses it for a file no profile recognised: the import runs to its end.
 */
async function importWith(
  owner: string,
  accountId: string,
  profileId: string,
  file = fortuneoFile(),
) {
  const { started, sameFile } = await imports.keep(owner, accountId, file);

  await imports.resumeWith(owner, started.id, {
    accountId: null,
    csvProfile: null,
    profile: { kind: "stored", id: profileId },
  });

  await imports.run(owner, started.id);

  return { ...(await imports.show(owner, started.id)), sameFile: sameFile !== null };
}

/** The user's account of this name (the made-up data's). */
async function accountNamed(owner: string, name: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: account.id }).from(account).where(eq(account.name, name)),
  );

  if (found === undefined) {
    throw new Error(`The user has no account named ${name}.`);
  }

  return found.id;
}

/** The import's lines on the account. */
const linesOfImport = (owner: string, importId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(eq(statementLine.importId, importId)),
  );

/** A user of the test's own, with the made-up data, their PEA and the library's profile. */
async function personWithPea(
  app: { baseURL: string },
  user: Parameters<typeof addUser>[1],
  local: string,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  await data.seed(owner);

  return {
    owner,
    pea: await accountNamed(owner, "Northbank PEA"),
    profile: await libraryProfile(owner),
  };
}

test("import an invented Fortuneo file with the library's profile: its operations and positions are there", async ({
  app,
  user,
}) => {
  const { owner, pea, profile } = await personWithPea(app, user, "broker-fortuneo");
  const before = await run(investmentOperations(owner, pea, { limit: 500 }));
  const done = await importWith(owner, pea, profile);

  expect(done).toMatchObject({
    status: "done",
    reads: "operations",
    profile: "Fortuneo (library)",
    linesRead: 6,
    linesAdded: 6,
    linesDuplicate: 0,
    periodFrom: "2026-11-02",
    periodTo: "2026-11-28",
    errorCode: null,
  });
  expect(await imports.profileOf(owner, done.id)).toEqual({
    profileId: profile,
    shippedProfile: null,
  });

  const after = await run(investmentOperations(owner, pea, { limit: 500 }));

  expect(after.total).toBe(before.total + 6);

  // The made-up data's operations are September's and October's: the file's are November's.
  const imported = after.operations.filter((each) => each.bookedOn >= "2026-11-01");

  expect(
    imported.map((each) => [each.kind, each.bookedOn, each.amount.minor, each.quantity]),
  ).toEqual([
    // Newest first, as the account lists its operations.
    ["fee", "2026-11-28", -300, null],
    ["sale", "2026-11-20", 5301, "2"],
    ["dividend", "2026-11-16", 255, null],
    ["purchase", "2026-11-05", -11_799, "4.5"],
    ["purchase", "2026-11-03", -25_295, "10"],
    ["deposit", "2026-11-02", 60_000, null],
  ]);

  // The position: 12.5 units held, the sale taking off its share of what they cost.
  const [listed] = (await run(investmentAccounts(owner))).filter((each) => each.id === pea);
  const position = listed?.positions.find((each) => each.security.isin === FUND);

  expect(position).toMatchObject({
    security: { isin: FUND, name: "FORTUNE WORLD ETF", currency: "EUR" },
    quantity: "12.5",
    cost: { minor: 25_295 + 11_799 - Math.round(((25_295 + 11_799) * 2) / 14.5), currency: "EUR" },
    incomplete: false,
    open: true,
  });
});

test("import the same Fortuneo file again with the library's profile: nothing is added", async ({
  app,
  user,
}) => {
  const { owner, pea, profile } = await personWithPea(app, user, "broker-again");
  const first = await importWith(owner, pea, profile);
  const total = (await run(investmentOperations(owner, pea, { limit: 500 }))).total;

  const again = await importWith(owner, pea, profile, {
    ...fortuneoFile(),
    fileName: "fortuneo-again.csv",
  });

  expect(first.linesAdded).toBe(6);
  expect(again).toMatchObject({
    status: "done",
    reads: "operations",
    sameFile: true,
    linesRead: 6,
    linesAdded: 0,
    linesDuplicate: 6,
  });
  expect((await run(investmentOperations(owner, pea, { limit: 500 }))).total).toBe(total);
  expect(await linesOfImport(owner, again.id)).toEqual([]);
});

test("a library profile imported, then a matching file uploaded, is read with it without picking", async ({
  app,
  user,
}) => {
  const { owner, pea, profile } = await personWithPea(app, user, "broker-recognised");
  const done = await imports.importFile(owner, pea, fortuneoFile());

  expect(done).toMatchObject({
    status: "done",
    reads: "operations",
    profile: "Fortuneo (library)",
    linesAdded: 6,
  });
  expect(await imports.profileOf(owner, done.id)).toEqual({
    profileId: profile,
    shippedProfile: null,
  });
});

test("undoing a Fortuneo import removes its operations and their lines", async ({ app, user }) => {
  const { owner, pea, profile } = await personWithPea(app, user, "broker-undo");
  const before = await run(investmentOperations(owner, pea, { limit: 500 }));
  const done = await importWith(owner, pea, profile);

  expect(await linesOfImport(owner, done.id)).toHaveLength(6);

  const undone = await imports.undo(owner, done.id);

  expect(undone).toMatchObject({ linesRemoved: 6, undone: { status: "undone" } });
  expect(await linesOfImport(owner, done.id)).toEqual([]);

  const after = await run(investmentOperations(owner, pea, { limit: 500 }));

  expect(after.total).toBe(before.total);

  const [listed] = (await run(investmentAccounts(owner))).filter((each) => each.id === pea);

  expect(listed?.positions.some((each) => each.security.isin === FUND)).toBe(false);

  // Its file imported again brings them back.
  expect((await importWith(owner, pea, profile)).linesAdded).toBe(6);
});

test("a broker's file read with its profile on a current account is refused", async ({
  app,
  user,
}) => {
  const { owner, profile } = await personWithPea(app, user, "broker-current");
  const current = await accountNamed(owner, "Current account");
  const { started } = await imports.keep(owner, current, fortuneoFile());

  await imports.resumeWith(owner, started.id, {
    accountId: null,
    csvProfile: null,
    profile: { kind: "stored", id: profile },
  });

  // The job fails for good, as the queue's last attempt would.
  await expect(imports.run(owner, started.id)).rejects.toMatchObject({
    code: "NOT_AN_INVESTMENT_ACCOUNT",
    retry: false,
  });

  const done = await imports.show(owner, started.id);

  expect(done).toMatchObject({
    status: "failed",
    errorCode: "NOT_AN_INVESTMENT_ACCOUNT",
    linesAdded: 0,
  });
  expect(await linesOfImport(owner, done.id)).toEqual([]);
});

test("no broker's profile is shipped: none reads a Fortuneo file until the user has one", async ({
  app,
  user,
}) => {
  const person = await addUser(app.baseURL, user, personOfItsOwn("broker-none"));
  const owner = await data.ownerOf(person.email);

  await data.seed(owner);

  const listed = await imports.withProfiles((service) => service.list(owner));

  expect(listed.filter((entry) => entry.kind === "operations")).toEqual([]);

  const pea = await accountNamed(owner, "Northbank PEA");
  const { started } = await imports.keep(owner, pea, fortuneoFile());
  const fitting = () => imports.withProfiles((service) => service.forImport(owner, started.id));

  expect((await fitting()).fitting).toEqual([]);

  // Imported from the library, kept with no header: it finds its columns by their names, and so
  // recognises the file by its header, as an upload does.
  const profile = await libraryProfile(owner);

  expect((await fitting()).fitting).toEqual([
    { by: "header", profile: expect.objectContaining({ source: "stored", id: profile }) },
  ]);
});
