import {
  DatabaseAccountStore,
  Today,
  investmentAccounts,
  investmentOperations,
  investmentsLayer,
  isinCheckDigit,
} from "@gousset/core";
import type { AccountStore, ImportProfileEntry, Investments } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { importsOn } from "../src/imports";
import { addUser, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 2: a broker's export of operations imported into an investment account, through
// the import's job on the worker's database, as the upload runs it. The Fortuneo file is invented,
// built from the profile Gousset ships for it (its header and the words of its kinds), and goes
// into the made-up PEA (`@gousset/fixture`, "Northbank PEA"). Every amount and ISIN is invented; the
// ISINs are in the country code XX, which no country has. Each test has a user of its own.

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

/** The profile Gousset ships for a broker, as the user's list of profiles gives it. */
async function shipped(owner: string, key: string) {
  const listed = await imports.withProfiles((service) => service.list(owner));
  const found = listed.find((entry) => entry.source === "shipped" && entry.key === key);
  const definition = found?.definition;

  if (found === undefined || definition === null || definition === undefined) {
    throw new Error(`No profile is shipped as ${key}.`);
  }

  if (!("reads" in definition)) {
    throw new Error(`${key} reads no operations.`);
  }

  return { entry: found, definition };
}

type Operations = Extract<NonNullable<ImportProfileEntry["definition"]>, { reads: "operations" }>;

/** The word of Fortuneo's kind column for a kind, as its shipped profile maps it. */
function wordOf(definition: Operations, kind: string): string {
  const found = definition.kinds.find((each) => each.kind === kind);

  if (found === undefined) {
    throw new Error(`The profile names no ${kind}.`);
  }

  return found.word;
}

/**
 * An invented Fortuneo export: the shipped header (`Date;Opération;Libellé;Code ISIN;Qté;Prix
 * d'exé;Montant brut;Courtage;Montant net;Devise`), then a deposit, two purchases, a dividend, a
 * sale and a custody fee, in Windows-1252 with semicolons, as the shipped profile reads.
 */
async function fortuneoFile(owner: string) {
  const { entry, definition } = await shipped(owner, "fortuneo-operations");
  const word = (kind: string) => wordOf(definition, kind);

  const rows = [
    ["02/11/2026", word("deposit"), "VIREMENT", "", "", "", "", "", "600,00", "EUR"],
    [
      "03/11/2026",
      word("purchase"),
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
      word("purchase"),
      "FORTUNE WORLD ETF",
      FUND,
      "4,5",
      "26,00",
      "",
      "0,99",
      "-117,99",
      "EUR",
    ],
    ["16/11/2026", word("dividend"), "FORTUNE WORLD ETF", FUND, "", "", "", "0,45", "2,55", "EUR"],
    [
      "20/11/2026",
      word("sale"),
      "FORTUNE WORLD ETF",
      FUND,
      "2",
      "27,00",
      "",
      "0,99",
      "53,01",
      "EUR",
    ],
    ["28/11/2026", word("fee"), "DROITS DE GARDE", "", "", "", "", "", "-3,00", "EUR"],
  ];

  const header = (entry.header ?? "").split(";");

  expect(header).toHaveLength(10);

  const text = [header, ...rows].map((row) => row.join(";")).join("\r\n");

  return { fileName: "fortuneo-2026-11.csv", bytes: encodeWindows1252(`${text}\r\n`) };
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

/** A user of the test's own, with the made-up data, and their PEA. */
async function personWithPea(
  app: { baseURL: string },
  user: Parameters<typeof addUser>[1],
  local: string,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  await data.seed(owner);

  return { owner, pea: await accountNamed(owner, "Northbank PEA") };
}

test("import an invented Fortuneo file into the made-up PEA: its operations and positions are there", async ({
  app,
  user,
}) => {
  const { owner, pea } = await personWithPea(app, user, "broker-fortuneo");
  const before = await run(investmentOperations(owner, pea, { limit: 500 }));
  const file = await fortuneoFile(owner);
  const done = await imports.importFile(owner, pea, file);

  expect(done).toMatchObject({
    status: "done",
    reads: "operations",
    linesRead: 6,
    linesAdded: 6,
    linesDuplicate: 0,
    periodFrom: "2026-11-02",
    periodTo: "2026-11-28",
    errorCode: null,
  });
  expect((await imports.profileOf(owner, done.id))?.shippedProfile).toBe("fortuneo-operations");

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

test("import the same Fortuneo file again: nothing is added", async ({ app, user }) => {
  const { owner, pea } = await personWithPea(app, user, "broker-again");
  const file = await fortuneoFile(owner);
  const first = await imports.importFile(owner, pea, file);
  const total = (await run(investmentOperations(owner, pea, { limit: 500 }))).total;
  const again = await imports.importFile(owner, pea, { ...file, fileName: "fortuneo-again.csv" });

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

test("undoing a Fortuneo import removes its operations and their lines", async ({ app, user }) => {
  const { owner, pea } = await personWithPea(app, user, "broker-undo");
  const before = await run(investmentOperations(owner, pea, { limit: 500 }));
  const done = await imports.importFile(owner, pea, await fortuneoFile(owner));

  expect(await linesOfImport(owner, done.id)).toHaveLength(6);

  const undone = await imports.undo(owner, done.id);

  expect(undone).toMatchObject({ linesRemoved: 6, undone: { status: "undone" } });
  expect(await linesOfImport(owner, done.id)).toEqual([]);

  const after = await run(investmentOperations(owner, pea, { limit: 500 }));

  expect(after.total).toBe(before.total);

  const [listed] = (await run(investmentAccounts(owner))).filter((each) => each.id === pea);

  expect(listed?.positions.some((each) => each.security.isin === FUND)).toBe(false);

  // Its file imported again brings them back.
  expect((await imports.importFile(owner, pea, await fortuneoFile(owner))).linesAdded).toBe(6);
});

test("a broker's file dropped on a current account is refused", async ({ app, user }) => {
  const { owner } = await personWithPea(app, user, "broker-current");
  const current = await accountNamed(owner, "Current account");
  const { started } = await imports.keep(owner, current, await fortuneoFile(owner));

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
