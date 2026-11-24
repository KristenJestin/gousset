import {
  DatabaseCategoryStore,
  LinkRefused,
  NotLinked,
  SplitRefused,
  Today,
  classifyLine,
  createCategory,
  expensesLayer,
  lineExpensesOf,
  linkLine,
  listCategories,
  splitLine,
  unlinkLine,
} from "@gousset/core";
import type { CategoryNode, CategoryStore, Expenses, Share } from "@gousset/core";
import { account, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #27, "How to verify": a 75 expense paid 25 + 50 on two accounts counts 75 once; a refund of
// 20 makes it 55; a split line sums to the line. And what keeps every euro counted once around
// them: a cancellation proposed as a refund, never applied unasked; a line unlinked; an undone
// import; the links refused. Statements are imported as the import job runs them, through
// `@gousset/core`, on the worker's database, into accounts of a user of this file's own; "where the
// money goes" is read as the categories page reads it, from the entries. Each test uses merchants
// and amounts of its own. Every amount and label is invented.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Noa Example",
    email: `noa.expenses.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
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

type Services = Expenses | CategoryStore;

/** Runs the expenses' and the categories' logic on a handle of the worker's database, `TODAY` today. */
const runOn =
  (handle: ReturnType<typeof openUserData>) =>
  <A, E>(effect: Effect.Effect<A, E, Services>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(
          Layer.mergeAll(expensesLayer, DatabaseCategoryStore).pipe(Layer.provide(handle.layer)),
        ),
        Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
      ),
    );

/** Runs the expenses' and the categories' logic on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runOn(data)(effect);

/** The refusal an effect fails with. */
const refusalOf = <A, E>(effect: Effect.Effect<A, E, Services>) => run(Effect.flip(effect));

const expensesOf = (lineId: string) => run(lineExpensesOf(owner, lineId));

async function newAccount(name: string, kind: "current" | "card" = "current"): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, currency: "EUR" })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** Imports these lines into the account, each with a reference of its own, to the end. */
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

  return done;
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

/** An expense category of this test's own, so that what it counts is this test's alone. */
const newCategory = async (name: string, kind: "expense" | "income" = "expense") =>
  (await run(createCategory(owner, { kind, name }))).id;

/** A category as the categories page lists it, with its entries and its six-month average. */
async function categoryNamed(name: string): Promise<CategoryNode> {
  const tree = await run(listCategories(owner));
  const found = [...tree.expense, ...tree.income].find((node) => node.name === name);

  if (found === undefined) {
    throw new Error(`No category named ${name}.`);
  }

  return found;
}

/** Every entry part of these lines: its line, its role, its amount and its entry's kind. */
const partsOf = (lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({
        lineId: entryPart.lineId,
        entryId: entryPart.entryId,
        role: entryPart.role,
        amountMinor: entryPart.amountMinor,
        kind: entry.kind,
        classifiedBy: entry.classifiedBy,
      })
      .from(entryPart)
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .where(inArray(entryPart.lineId, [...lineIds])),
  );

test("a 75 expense paid 25 + 50 on two accounts counts 75 once", async () => {
  const current = await newAccount("Parts current");
  const card = await newAccount("Parts card", "card");

  await importInto(current, "parts-current", [
    { bookedOn: "2026-10-12", amountMinor: -2500, label: "CB HARBOR HOME 1210 RIVERTON" },
  ]);

  await importInto(card, "parts-card", [
    { bookedOn: "2026-10-12", amountMinor: -5000, label: "CB HARBOR HOME 1210 RIVERTON" },
  ]);

  const onCurrent = await lineOf(current, -2500);
  const onCard = await lineOf(card, -5000);
  const kitchen = await newCategory("Kitchen seventy-five");

  // Two lines, two expenses, as the import made them.
  expect((await expensesOf(onCurrent)).expenses).toHaveLength(1);

  const linked = await run(linkLine(owner, onCard, onCurrent));

  expect(linked.role).toBe("payment");
  expect(linked.expense.net).toEqual({ minor: 7500, currency: "EUR" });

  expect(linked.expense.payments.map((part) => [part.account.name, part.amount.minor])).toEqual([
    ["Parts current", 2500],
    ["Parts card", 5000],
  ]);

  await run(classifyLine(owner, onCurrent, { categoryId: kitchen }));

  // One expense, wherever it is read from.
  const fromCard = await expensesOf(onCard);

  expect(fromCard.expenses.map((expense) => expense.id)).toEqual([linked.expense.id]);
  expect(fromCard.expenses[0]?.category.name).toBe("Kitchen seventy-five");

  // Where the money goes counts it once, at 75: one entry, and 75 over the six months averaged.
  const counted = await categoryNamed("Kitchen seventy-five");

  expect(counted.entries).toBe(1);
  expect(counted.average).toEqual([{ currency: "EUR", minor: Math.round(7500 / 6) }]);

  // An account shows its payments: each line stays as the bank wrote it, on its own account.
  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ accountId: statementLine.accountId, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(inArray(statementLine.id, [onCurrent, onCard])),
  );

  expect(lines.toSorted((a, b) => a.amountMinor - b.amountMinor)).toEqual([
    { accountId: card, amountMinor: -5000 },
    { accountId: current, amountMinor: -2500 },
  ]);
});

test("a refund of 20 makes it 55", async () => {
  const current = await newAccount("Refund current");
  const card = await newAccount("Refund card", "card");

  await importInto(current, "refund-current", [
    { bookedOn: "2026-10-05", amountMinor: -2500, label: "CB FERNHILL GARDEN 0510 RIVERTON" },
    {
      bookedOn: "2026-10-20",
      amountMinor: 2000,
      label: "VIR SEPA RECU /DE SAM EXAMPLE /MOTIF SHARE",
    },
  ]);

  await importInto(card, "refund-card", [
    { bookedOn: "2026-10-05", amountMinor: -5000, label: "CB FERNHILL GARDEN 0510 RIVERTON" },
  ]);

  const onCurrent = await lineOf(current, -2500);
  const onCard = await lineOf(card, -5000);
  const back = await lineOf(current, 2000);
  const garden = await newCategory("Garden fifty-five");

  await run(linkLine(owner, onCard, onCurrent));
  await run(classifyLine(owner, onCurrent, { categoryId: garden }));

  // A friend pays back their share: a refund of the expense, no income of its own.
  const refunded = await run(linkLine(owner, back, onCard));

  expect(refunded.role).toBe("refund");
  expect(refunded.expense.net).toEqual({ minor: 5500, currency: "EUR" });
  expect(refunded.expense.refunds.map((part) => part.amount.minor)).toEqual([2000]);

  expect(await partsOf([back])).toEqual([
    expect.objectContaining({ role: "refund", amountMinor: 2000, kind: "expense" }),
  ]);

  const counted = await categoryNamed("Garden fifty-five");

  expect(counted.entries).toBe(1);
  expect(counted.average).toEqual([{ currency: "EUR", minor: Math.round(5500 / 6) }]);

  // A refund never makes an expense cost less than nothing.
  const tooMuch = await newAccount("Refund too much");

  await importInto(tooMuch, "refund-too-much", [
    {
      bookedOn: "2026-10-21",
      amountMinor: 6000,
      label: "VIR SEPA RECU /DE SAM EXAMPLE /MOTIF ALL",
    },
  ]);

  const all = await lineOf(tooMuch, 6000);

  expect(await refusalOf(linkLine(owner, all, onCurrent))).toEqual(
    new LinkRefused({ reason: "exceeds", lineId: all }),
  );
});

test("a split line sums to the line", async () => {
  const current = await newAccount("Split current");

  await importInto(current, "split-current", [
    { bookedOn: "2026-10-08", amountMinor: -9000, label: "CB LANTERN STORES 0810 RIVERTON" },
  ]);

  const line = await lineOf(current, -9000);
  const food = await newCategory("Split food");
  const home = await newCategory("Split home");

  const shares: ReadonlyArray<Share> = [
    { categoryId: food, amount: "30" },
    { categoryId: home, amount: "60.00" },
  ];

  const split = await run(splitLine(owner, line, shares));

  expect(split.expenses.map((expense) => [expense.category.name, expense.net.minor])).toEqual([
    ["Split food", 3000],
    ["Split home", 6000],
  ]);

  const parts = await partsOf([line]);

  expect(parts.reduce((sum, part) => sum + part.amountMinor, 0)).toBe(9000);
  expect(parts.every((part) => part.classifiedBy === "user")).toBe(true);

  // Shares that do not sum to the line are refused, and the line stays as it was.
  expect(
    await refusalOf(
      splitLine(owner, line, [
        { categoryId: food, amount: "30" },
        { categoryId: home, amount: "50" },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "sum" }));

  expect(await partsOf([line])).toHaveLength(2);

  // An income category for money out is refused, naming the share.
  const salary = await newCategory("Split salary", "income");

  expect(
    await refusalOf(
      splitLine(owner, line, [
        { categoryId: food, amount: "30" },
        { categoryId: salary, amount: "60" },
      ]),
    ),
  ).toEqual(new SplitRefused({ reason: "kind", index: 1 }));

  // One share puts the whole line back in one category.
  const whole = await run(splitLine(owner, line, [{ categoryId: home, amount: "90" }]));

  expect(whole.expenses.map((expense) => expense.net.minor)).toEqual([9000]);
});

test("a cancellation is proposed as a refund, never applied unasked", async () => {
  const current = await newAccount("Cancel current");

  await importInto(current, "cancel-current", [
    { bookedOn: "2026-10-03", amountMinor: -5600, label: "CB CORNER BISTRO 0310 RIVERTON" },
    { bookedOn: "2026-10-06", amountMinor: 5600, label: "AVOIR CORNER BISTRO RIVERTON" },
  ]);

  const purchase = await lineOf(current, -5600);
  const cancelled = await lineOf(current, 5600);

  // Proposed, not applied: the line coming back is still an income of its own.
  const proposed = await expensesOf(cancelled);

  expect(proposed.proposals.map((each) => each.line.lineId)).toEqual([purchase]);
  expect(proposed.expenses.map((expense) => expense.kind)).toEqual(["income"]);
  expect(await partsOf([cancelled])).toEqual([
    expect.objectContaining({ role: "payment", kind: "income" }),
  ]);

  // The user confirms it: the purchase costs nothing any more.
  const confirmed = await run(linkLine(owner, cancelled, purchase));

  expect(confirmed).toMatchObject({ role: "refund", expense: { net: { minor: 0 } } });
  expect((await expensesOf(cancelled)).proposals).toEqual([]);

  // A line the user classified is no proposal any more.
  const other = await newAccount("Cancel classified");

  await importInto(other, "cancel-classified", [
    { bookedOn: "2026-10-10", amountMinor: -3300, label: "CB HARBOR BOOKS 1010 RIVERTON" },
    { bookedOn: "2026-10-12", amountMinor: 3300, label: "AVOIR HARBOR BOOKS RIVERTON" },
  ]);

  const kept = await lineOf(other, 3300);

  expect((await expensesOf(kept)).proposals).toHaveLength(1);

  await run(classifyLine(owner, kept, { fallbackOf: "income" }));

  expect((await expensesOf(kept)).proposals).toEqual([]);
});

test("a purchase is never proposed as the refund of an earlier income", async () => {
  const current = await newAccount("Purchase current");

  await importInto(current, "purchase-current", [
    { bookedOn: "2026-11-01", amountMinor: -3000, label: "CB WILLOW SHOP 0111 RIVERTON" },
    { bookedOn: "2026-11-10", amountMinor: 3000, label: "AVOIR WILLOW SHOP RIVERTON" },
    { bookedOn: "2026-11-20", amountMinor: -3000, label: "CB WILLOW SHOP 2011 RIVERTON" },
  ]);

  const [first, back, again] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.accountId, current))
      .orderBy(asc(statementLine.bookedOn)),
  );

  // The line coming back may cancel the purchase before it; the purchase after it cancels nothing,
  // though the line coming back, never linked, is an income of its own of the same merchant.
  expect((await expensesOf(back?.id ?? "")).proposals.map((each) => each.line.lineId)).toEqual([
    first?.id,
  ]);
  expect((await expensesOf(again?.id ?? "")).proposals).toEqual([]);
});

test("a line taken out of its expense is its own again", async () => {
  const current = await newAccount("Unlink current");
  const card = await newAccount("Unlink card", "card");

  await importInto(current, "unlink-current", [
    { bookedOn: "2026-10-14", amountMinor: -1200, label: "CB MILL BAKERY 1410 RIVERTON" },
    {
      bookedOn: "2026-10-16",
      amountMinor: 700,
      label: "VIR SEPA RECU /DE ALEX EXAMPLE /MOTIF BREAD",
    },
  ]);

  await importInto(card, "unlink-card", [
    { bookedOn: "2026-10-14", amountMinor: -800, label: "CB MILL BAKERY 1410 RIVERTON" },
  ]);

  const first = await lineOf(current, -1200);
  const second = await lineOf(card, -800);
  const back = await lineOf(current, 700);

  await run(linkLine(owner, second, first));
  await run(linkLine(owner, back, first));

  // The second payment leaves: an expense of its own again, the first keeping its refund.
  const separated = await run(unlinkLine(owner, second));

  expect(separated.expenses.map((expense) => expense.net.minor)).toEqual([800]);
  expect((await expensesOf(first)).expenses[0]?.net.minor).toBe(500);

  // The last payment leaves: its refund, alone, is an income of its own again.
  await run(unlinkLine(owner, first));

  expect(await partsOf([first, back])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ lineId: first, role: "payment", kind: "expense" }),
      expect.objectContaining({ lineId: back, role: "payment", kind: "income" }),
    ]),
  );

  expect(await refusalOf(unlinkLine(owner, first))).toEqual(new NotLinked({ lineId: first }));
});

const Waiting = Schema.Struct({ rows: Schema.Array(Schema.Struct({ waiting: Schema.Number })) });

/** How many locks of this worker's database's sessions wait for another's. */
async function waitingLocks(): Promise<number> {
  const result = await data.asUser(owner, (transaction) =>
    transaction.execute(
      sql`select count(*)::int as waiting from pg_locks l
          join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.datname = current_database()`,
    ),
  );

  return Schema.decodeUnknownSync(Waiting)(result).rows[0]?.waiting ?? 0;
}

test("an unlink and a link meeting on one expense both go through, neither ended as a deadlock", async ({
  app,
}) => {
  const current = await newAccount("Locks current");

  await importInto(current, "locks-current", [
    { bookedOn: "2026-10-22", amountMinor: -4000, label: "CB QUARRY TOOLS 2210 RIVERTON" },
    {
      bookedOn: "2026-10-24",
      amountMinor: 1500,
      label: "VIR SEPA RECU /DE RIO EXAMPLE /MOTIF TOOLS",
    },
    { bookedOn: "2026-10-25", amountMinor: -600, label: "CB QUARRY TOOLS 2510 RIVERTON" },
  ]);

  const paid = await lineOf(current, -4000);
  const back = await lineOf(current, 1500);
  const more = await lineOf(current, -600);
  const expense = (await run(linkLine(owner, back, paid))).expense.id;

  // Three connections of their own: one holds the expense, so that the unlink, then the link, wait
  // for it in that order. The unlink takes away the expense's only payment, which frees its refund:
  // a new part for that line, whose foreign key takes `key share` on it, while the link holds it.
  const holder = openUserData(app.database);
  const first = openUserData(app.database);
  const second = openUserData(app.database);
  const { promise: released, resolve: release } = Promise.withResolvers<void>();

  const held = holder.asUser(owner, async (transaction) => {
    await transaction
      .select({ id: entry.id })
      .from(entry)
      .where(eq(entry.id, expense))
      .for("update");
    await released;
  });

  try {
    const unlinked = runOn(first)(unlinkLine(owner, paid));

    await expect.poll(waitingLocks).toBeGreaterThanOrEqual(1);

    const linked = runOn(second)(linkLine(owner, more, back));

    await expect.poll(waitingLocks).toBeGreaterThanOrEqual(2);
    release();

    const [left, joined] = await Promise.allSettled([unlinked, linked]);

    expect([left.status, joined.status]).toEqual(["fulfilled", "fulfilled"]);

    // The refund, alone again, is an income of its own, which the purchase after it now refunds.
    expect(await partsOf([back, more])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lineId: back, role: "payment", kind: "income" }),
        expect.objectContaining({ lineId: more, role: "refund", kind: "income" }),
      ]),
    );
  } finally {
    release();
    await held;
    await Promise.all([holder.close(), first.close(), second.close()]);
  }
});

test("undoing the import of an expense's payment gives its refund back its own entry", async () => {
  const current = await newAccount("Undo current");
  const card = await newAccount("Undo card", "card");

  await importInto(current, "undo-current", [
    {
      bookedOn: "2026-10-18",
      amountMinor: 1500,
      label: "VIR SEPA RECU /DE KIM EXAMPLE /MOTIF TICKETS",
    },
  ]);

  const paid = await importInto(card, "undo-card", [
    { bookedOn: "2026-10-17", amountMinor: -4500, label: "CB PALACE CINEMA 1710 RIVERTON" },
  ]);

  const back = await lineOf(current, 1500);

  await run(linkLine(owner, back, await lineOf(card, -4500)));
  await imports.undo(owner, paid.id);

  // The tickets' expense is gone with its payment: the refund is an income of its own again.
  expect(await partsOf([back])).toEqual([
    expect.objectContaining({ role: "payment", amountMinor: 1500, kind: "income" }),
  ]);
});

test("a payment leaving an expense never leaves it costing less than nothing, and its day follows", async () => {
  const current = await newAccount("Leaving current");
  const card = await newAccount("Leaving card", "card");

  await importInto(current, "leaving-current", [
    { bookedOn: "2026-09-28", amountMinor: -10_000, label: "CB FOXGLOVE FLOWERS 2809 RIVERTON" },
    {
      bookedOn: "2026-10-05",
      amountMinor: 12_000,
      label: "VIR SEPA RECU /DE JO EXAMPLE /MOTIF FLOWERS",
    },
  ]);

  await importInto(card, "leaving-card", [
    { bookedOn: "2026-10-02", amountMinor: -5000, label: "CB FOXGLOVE FLOWERS 0210 RIVERTON" },
  ]);

  const first = await lineOf(current, -10_000);
  const second = await lineOf(card, -5000);
  const back = await lineOf(current, 12_000);

  // Paid 100 then 50, 120 back: it costs 30, and happened on its first payment's day.
  await run(linkLine(owner, first, second));

  const refunded = await run(linkLine(owner, back, second));

  expect(refunded.expense).toMatchObject({ happenedOn: "2026-09-28", net: { minor: 3000 } });

  // The 100 leaves: 120 back would make 50 cost less than nothing, so the 120 is its own again.
  await run(unlinkLine(owner, first));

  const [left] = (await expensesOf(second)).expenses;

  expect(left).toMatchObject({ happenedOn: "2026-10-02", net: { minor: 5000 }, refunds: [] });

  expect(await partsOf([back])).toEqual([
    expect.objectContaining({ role: "payment", amountMinor: 12_000, kind: "income" }),
  ]);

  // An earlier payment undone with its import: the day follows to the payment left.
  const early = await newAccount("Leaving early");

  const undone = await importInto(early, "leaving-early", [
    { bookedOn: "2026-09-20", amountMinor: -700, label: "CB FOXGLOVE FLOWERS 2009 RIVERTON" },
  ]);

  const moved = await run(linkLine(owner, await lineOf(early, -700), second));

  expect(moved.expense.happenedOn).toBe("2026-09-20");

  await imports.undo(owner, undone.id);

  expect((await expensesOf(second)).expenses[0]?.happenedOn).toBe("2026-10-02");
});

test("a link that would count a euro twice is refused", async () => {
  const current = await newAccount("Refused current");
  const savings = await newAccount("Refused savings");

  await importInto(current, "refused-current", [
    { bookedOn: "2026-10-22", amountMinor: -4200, label: "CB QUAY MARKET 2210 RIVERTON" },
    { bookedOn: "2026-10-23", amountMinor: -10_100, label: "VIR SEPA TO MY SAVINGS" },
  ]);

  await importInto(savings, "refused-savings", [
    { bookedOn: "2026-10-23", amountMinor: 10_100, label: "VIR SEPA FROM MY CURRENT" },
  ]);

  const market = await lineOf(current, -4200);
  const out = await lineOf(current, -10_100);

  // The transfer is paired by the import: a side of it is never an expense's part.
  expect(await refusalOf(linkLine(owner, out, market))).toEqual(
    new LinkRefused({ reason: "transfer", lineId: out }),
  );

  expect(await refusalOf(linkLine(owner, market, market))).toEqual(
    new LinkRefused({ reason: "same_line", lineId: market }),
  );

  // A split line is classified share by share: it joins no other expense.
  const food = await newCategory("Refused food");
  const home = await newCategory("Refused home");

  await run(
    splitLine(owner, market, [
      { categoryId: food, amount: "20" },
      { categoryId: home, amount: "22" },
    ]),
  );

  const other = await newAccount("Refused other");

  await importInto(other, "refused-other", [
    { bookedOn: "2026-10-22", amountMinor: -900, label: "CB QUAY MARKET 2210 RIVERTON" },
  ]);

  expect(await refusalOf(linkLine(owner, await lineOf(other, -900), market))).toEqual(
    new LinkRefused({ reason: "split", lineId: market }),
  );
});
