import {
  DatabaseAccountStore,
  DatabaseCategoryStore,
  editAccount,
  Today,
  classifyLine,
  createCategory,
  expensesLayer,
  lineExpensesOf,
  matchTopUps,
  recogniseMerchants,
  setMerchantDefaultCategory,
  unlinkLine,
} from "@gousset/core";
import type { AccountInput } from "@gousset/core/account-values";
import type { AccountStore, CategoryStore, Expenses } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { account, entry, entryPart, merchant, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #28, "How to verify": tests on invented lines, matched within the issuer's delay, not
// matched when the amounts or the moments disagree. And what keeps them safe around it: two
// candidates never guessed, a line the user classified or took out left alone, a run again that
// adds nothing, and a card kept by its balance, whose top-ups go to its category. Statements are
// imported as the import job runs them, through `@gousset/core`, on the worker's database, into
// accounts of a user of this file's own; the matching runs at the end of each import. Each test
// has an issuer and amounts of its own. Every issuer, amount and label is invented.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Ivo Example",
    email: `ivo.top-ups.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-ivo-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

/** Every line of these tests is booked before this day, which the logic reads as today. */
const TODAY = "2026-11-30";

type Services = Expenses | CategoryStore | AccountStore | UserData;

const run = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(expensesLayer, DatabaseCategoryStore, DatabaseAccountStore, data.layer).pipe(
          Layer.provide(data.layer),
        ),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

type NewAccount = {
  readonly name: string;
  readonly kind: "current" | "benefit";
  readonly institution?: string;
  readonly mode?: "lines" | "balance";
  readonly topUpDays?: number;
  readonly topUpCapMinor?: number;
  readonly balanceCategoryId?: string;
};

async function newAccount(values: NewAccount): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, currency: "EUR", ...values })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** Imports these lines into the account, each with a reference of its own. */
async function importInto(
  accountId: string,
  name: string,
  lines: ReadonlyArray<Omit<StatementLine, "reference">>,
) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${name}.ofx`),
  );

  expect(done.status, name).toBe("done");
}

/** The account's line of this amount. */
async function lineOf(accountId: string, amountMinor: number): Promise<string> {
  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );

  const found = lines.find((line) => line.amountMinor === amountMinor);

  if (found === undefined) {
    throw new Error(`No line of ${String(amountMinor)} on the account.`);
  }

  return found.id;
}

/** The entries these lines have a part in, one id per line. */
const entriesOf = async (lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({
        lineId: entryPart.lineId,
        entryId: entryPart.entryId,
        categoryId: entry.categoryId,
      })
      .from(entryPart)
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .where(inArray(entryPart.lineId, [...lineIds])),
  );

/** Whether the two lines are one expense. */
async function oneExpense(first: string, second: string): Promise<boolean> {
  const parts = await entriesOf([first, second]);

  return parts.length === 2 && new Set(parts.map((part) => part.entryId)).size === 1;
}

/** A benefit card with a credit, then a purchase that spends `spentMinor` of it on `day`. */
async function cardWithPurchase(
  issuer: string,
  creditMinor: number,
  spentMinor: number,
  day: string,
  settings: Partial<NewAccount> = {},
) {
  const card = await newAccount({
    name: `${issuer} card`,
    kind: "benefit",
    institution: issuer,
    ...settings,
  });

  await importInto(card, `${issuer}-card`, [
    { bookedOn: "2026-10-01", amountMinor: creditMinor, label: `${issuer.toUpperCase()} CREDIT` },
    { bookedOn: day, amountMinor: -spentMinor, label: "CB GREENMARKET RIVERTON" },
  ]);

  return { card, purchase: await lineOf(card, -spentMinor) };
}

test("matched within the issuer's delay", async () => {
  const { purchase } = await cardWithPurchase("Lunchora", 4321, 4321, "2026-10-10");
  const current = await newAccount({ name: "Lunchora current", kind: "current" });

  // Booked two days after the card's line: within its issuer's 3 days.
  await importInto(current, "lunchora-current", [
    { bookedOn: "2026-10-12", amountMinor: -1679, label: "CB LUNCHORA*TOPUP 1010" },
  ]);

  const rest = await lineOf(current, -1679);

  expect(await oneExpense(purchase, rest)).toBe(true);

  const read = await run(lineExpensesOf(owner, rest));

  expect(read.expenses).toHaveLength(1);
  expect(read.expenses[0]?.net).toEqual({ minor: 6000, currency: "EUR" });
  expect(read.expenses[0]?.payments.map((part) => part.lineId)).toEqual([purchase, rest]);

  // The boot's run, again: nothing left to do.
  expect(await run(matchTopUps(owner))).toBe(0);
  expect(await oneExpense(purchase, rest)).toBe(true);
});

test("matched at the card's daily cap, money left on it", async () => {
  const { purchase } = await cardWithPurchase("Mealwise", 20_000, 2500, "2026-10-10", {
    topUpCapMinor: 2500,
  });

  const current = await newAccount({ name: "Mealwise current", kind: "current" });

  await importInto(current, "mealwise-current", [
    { bookedOn: "2026-10-10", amountMinor: -1150, label: "PAIEMENT MEAL WISE COMPLEMENT" },
  ]);

  expect(await oneExpense(purchase, await lineOf(current, -1150))).toBe(true);
});

test("not matched when the amounts disagree", async () => {
  // The card had money left and no cap was reached: the issuer had nothing to charge elsewhere.
  const { purchase } = await cardWithPurchase("Platewise", 10_000, 3100, "2026-10-10", {
    topUpCapMinor: 5000,
  });

  const current = await newAccount({ name: "Platewise current", kind: "current" });

  await importInto(current, "platewise-current", [
    { bookedOn: "2026-10-10", amountMinor: -900, label: "CB PLATEWISE*TOPUP" },
  ]);

  expect(await oneExpense(purchase, await lineOf(current, -900))).toBe(false);
});

test("not matched when the moments disagree", async () => {
  const { purchase } = await cardWithPurchase("Forkly", 3333, 3333, "2026-10-10", {
    topUpDays: 1,
  });

  const current = await newAccount({ name: "Forkly current", kind: "current" });

  // One the day before the card's line, one two days after its issuer's single day.
  await importInto(current, "forkly-current", [
    { bookedOn: "2026-10-09", amountMinor: -410, label: "CB FORKLY*TOPUP" },
    { bookedOn: "2026-10-12", amountMinor: -420, label: "CB FORKLY*TOPUP" },
  ]);

  expect(await oneExpense(purchase, await lineOf(current, -410))).toBe(false);
  expect(await oneExpense(purchase, await lineOf(current, -420))).toBe(false);
});

test("two candidate top-ups go to the review, never guessed", async () => {
  const { purchase } = await cardWithPurchase("Brunchly", 2222, 2222, "2026-10-10");
  const current = await newAccount({ name: "Brunchly current", kind: "current" });

  await importInto(current, "brunchly-current", [
    { bookedOn: "2026-10-10", amountMinor: -510, label: "CB BRUNCHLY*TOPUP" },
    { bookedOn: "2026-10-11", amountMinor: -520, label: "CB BRUNCHLY*TOPUP" },
  ]);

  const first = await lineOf(current, -510);
  const second = await lineOf(current, -520);

  expect(await oneExpense(purchase, first)).toBe(false);
  expect(await oneExpense(purchase, second)).toBe(false);
  expect(
    new Set((await entriesOf([purchase, first, second])).map((part) => part.entryId)).size,
  ).toBe(3);
});

test("a card line the user classified still counts as a candidate, so nothing is guessed", async () => {
  const card = await newAccount({
    name: "Crumbly card",
    kind: "benefit",
    institution: "Crumbly",
    topUpCapMinor: 2500,
  });

  // Two days at the cap: Monday's purchase classified by the user, then Tuesday's.
  await importInto(card, "crumbly-card", [
    { bookedOn: "2026-10-01", amountMinor: 20_000, label: "CRUMBLY CREDIT" },
    { bookedOn: "2026-10-12", amountMinor: -2500, label: "CB GREENMARKET RIVERTON" },
    { bookedOn: "2026-10-13", amountMinor: -2500, label: "CB LANTERN STORES RIVERTON" },
  ]);

  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.accountId, card))
      .orderBy(asc(statementLine.bookedOn)),
  );

  const monday = lines[1]?.id ?? "";
  const tuesday = lines[2]?.id ?? "";
  const kept = (await run(createCategory(owner, { kind: "expense", name: "Crumbly kept" }))).id;

  await run(classifyLine(owner, monday, { categoryId: kept }));

  const current = await newAccount({ name: "Crumbly current", kind: "current" });

  // Within 3 days of both: either purchase's rest, so neither.
  await importInto(current, "crumbly-current", [
    { bookedOn: "2026-10-14", amountMinor: -1500, label: "CB CRUMBLY*TOPUP" },
  ]);

  const rest = await lineOf(current, -1500);

  expect(await oneExpense(tuesday, rest)).toBe(false);
  expect(await oneExpense(monday, rest)).toBe(false);
});

test("a line the user classified is never matched", async () => {
  const current = await newAccount({ name: "Snackwell current", kind: "current" });
  const kept = (await run(createCategory(owner, { kind: "expense", name: "Snackwell kept" }))).id;

  await importInto(current, "snackwell-current", [
    { bookedOn: "2026-10-11", amountMinor: -610, label: "CB SNACKWELL*TOPUP" },
  ]);

  const rest = await lineOf(current, -610);

  // Classified by the user before the card's statement is imported: it stays theirs.
  await run(classifyLine(owner, rest, { categoryId: kept }));

  const { purchase } = await cardWithPurchase("Snackwell", 1717, 1717, "2026-10-10");

  expect(await oneExpense(purchase, rest)).toBe(false);
  expect(await run(matchTopUps(owner))).toBe(0);
});

test("unlinking a top-up restores two separate entries, which no run links again", async () => {
  const { purchase } = await cardWithPurchase("Dinerly", 2468, 2468, "2026-10-10");
  const current = await newAccount({ name: "Dinerly current", kind: "current" });

  await importInto(current, "dinerly-current", [
    { bookedOn: "2026-10-10", amountMinor: -732, label: "CB DINERLY*TOPUP" },
  ]);

  const rest = await lineOf(current, -732);

  expect(await oneExpense(purchase, rest)).toBe(true);

  const separated = await run(unlinkLine(owner, rest));

  expect(separated.expenses.map((expense) => expense.net.minor)).toEqual([732]);
  expect(await oneExpense(purchase, rest)).toBe(false);
  expect(await entriesOf([purchase, rest])).toHaveLength(2);

  // The user's "not one expense" holds through the boot's run.
  expect(await run(matchTopUps(owner))).toBe(0);
  expect(await oneExpense(purchase, rest)).toBe(false);
});

test("without the card's lines, the top-up goes to the card's category", async () => {
  const meals = (await run(createCategory(owner, { kind: "expense", name: "Tablewise meals" }))).id;

  const tablewise = await newAccount({
    name: "Tablewise card",
    kind: "benefit",
    institution: "Tablewise",
    mode: "balance",
    balanceCategoryId: meals,
  });

  const current = await newAccount({ name: "Tablewise current", kind: "current" });

  await importInto(current, "tablewise-current", [
    { bookedOn: "2026-10-10", amountMinor: -845, label: "CB TABLEWISE*TOPUP" },
    { bookedOn: "2026-10-10", amountMinor: -846, label: "CB GREENMARKET RIVERTON" },
  ]);

  const topUpLine = await lineOf(current, -845);
  const [topUp] = await entriesOf([topUpLine]);
  const [other] = await entriesOf([await lineOf(current, -846)]);

  expect(topUp?.categoryId).toBe(meals);
  expect(other?.categoryId).not.toBe(meals);

  // Kept by its lines from now on: its top-ups leave its category, back to the fallback.
  await run(
    editAccount(owner, tablewise, {
      name: "Tablewise card",
      choice: "benefit",
      institution: "Tablewise",
      currency: "EUR",
      mode: "lines",
      openingBalanceMinor: 0,
    }),
  );

  const [back] = await entriesOf([topUpLine]);

  expect(back?.categoryId).toBe(other?.categoryId);
});

/** A card kept by its balance in a category of its own, and a bank top-up of it in that category. */
async function balanceCardWithTopUp(issuer: string, amountMinor: number) {
  const meals = (await run(createCategory(owner, { kind: "expense", name: `${issuer} meals` }))).id;

  const card = await newAccount({
    name: `${issuer} card`,
    kind: "benefit",
    institution: issuer,
    mode: "balance",
    balanceCategoryId: meals,
  });

  const current = await newAccount({ name: `${issuer} current`, kind: "current" });

  await importInto(current, `${issuer}-current`, [
    { bookedOn: "2026-10-10", amountMinor, label: `CB ${issuer.toUpperCase()}*TOPUP` },
  ]);

  const line = await lineOf(current, amountMinor);
  const [entered] = await entriesOf([line]);

  expect(entered?.categoryId).toBe(meals);

  return { meals, card, line };
}

const editCard = (cardId: string, issuer: string, change: Partial<AccountInput>) =>
  run(
    editAccount(owner, cardId, {
      name: `${issuer} card`,
      choice: "benefit",
      institution: issuer,
      currency: "EUR",
      mode: "balance",
      openingBalanceMinor: 0,
      ...change,
    }),
  );

const categoryOf = async (lineId: string) => (await entriesOf([lineId]))[0]?.categoryId;

test("a top-up in its merchant's own default category stays there once the card no longer sends it", async () => {
  const { meals, card, line } = await balanceCardWithTopUp("Sweetbite", -955);

  const [named] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: merchant.id })
      .from(merchant)
      .where(sql`lower(${merchant.name}) like 'sweetbite%'`),
  );

  await run(setMerchantDefaultCategory(owner, named?.id ?? "", meals));
  await editCard(card, "Sweetbite", { mode: "lines" });

  expect(await categoryOf(line)).toBe(meals);

  // And at the boot's runs, again and again.
  await run(recogniseMerchants(owner));
  await run(matchTopUps(owner));
  await run(recogniseMerchants(owner));

  expect(await categoryOf(line)).toBe(meals);
});

test("a card's category cleared, or its issuer renamed, sends its top-ups back", async () => {
  const cleared = await balanceCardWithTopUp("Nibbleton", -965);

  await editCard(cleared.card, "Nibbleton", { balanceCategoryId: null });

  expect(await categoryOf(cleared.line)).not.toBe(cleared.meals);

  const renamed = await balanceCardWithTopUp("Morselly", -975);

  await editCard(renamed.card, "Morselly", { institution: "Other Issuer" });

  expect(await categoryOf(renamed.line)).not.toBe(renamed.meals);
});
