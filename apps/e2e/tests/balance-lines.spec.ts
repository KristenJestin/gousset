import {
  DatabaseAccountStore,
  DatabaseLineStore,
  Today,
  editAccount,
  noteBalance,
  pairLineWithAccount,
  remakeEveryBalanceLine,
  searchLines,
  transfersLayer,
  unpairLine,
} from "@gousset/core";
import type { AccountStore, LineStore, Transfers } from "@gousset/core";
import type { AccountInput } from "@gousset/core/account-values";
import type { UserData } from "@gousset/db/user-data";
import { account, category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #31: an account kept by its balance gets one line per noted balance, the movement since the
// one before less the other lines booked in between, as one expense or income in the account's
// category. These run the logic itself, through `@gousset/core`, on the worker's database, into
// accounts of a user of this file's own; the browser's and the MCP door's own tests of the issue's
// scenario are balance-accounts.spec.ts and its MCP spec. Every amount and label is invented.

let data: ReturnType<typeof openUserData>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  const person = await addUser(app.baseURL, user, {
    name: "Ines Example",
    email: `ines.balances.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-ines-password-${app.slot}`,
  });

  data = openUserData(app.database);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

/** Every day of these tests is before this one, which the logic reads as today. */
const TODAY = "2026-11-30";

/** Runs the accounts' and the transfers' logic on the worker's database, `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, AccountStore | Transfers | LineStore | UserData>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(DatabaseAccountStore, transfersLayer, DatabaseLineStore).pipe(
          Layer.provideMerge(data.layer),
        ),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** One of the user's categories (the default set's), by kind and name. */
async function categoryNamed(kind: "expense" | "income", name: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.kind, kind), eq(category.name, name))),
  );

  if (found === undefined) {
    throw new Error(`No ${kind} category named ${name}.`);
  }

  return found.id;
}

/** The user's fallback category of a kind. */
async function fallbackOf(kind: "expense" | "income"): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.kind, kind), eq(category.isFallback, true))),
  );

  if (found === undefined) {
    throw new Error(`No ${kind} fallback.`);
  }

  return found.id;
}

/** A new open account of the user's, in euros. */
async function newAccount(
  name: string,
  kind: "current" | "benefit",
  mode: "lines" | "balance",
  balanceCategoryId: string | null = null,
): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, mode, currency: "EUR", balanceCategoryId })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** A line entered on the account, counted. */
async function lineOn(accountId: string, bookedOn: string, amountMinor: number): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(statementLine)
      .values({ userId: owner, accountId, source: "manual", bookedOn, amountMinor, label: "TOPUP" })
      .returning({ id: statementLine.id }),
  );

  if (created === undefined) {
    throw new Error("The line was not created.");
  }

  return created.id;
}

/** The account's movement lines, oldest first, each with its entry's kind and category. */
const movementsOf = (accountId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({
        bookedOn: statementLine.bookedOn,
        amountMinor: statementLine.amountMinor,
        kind: entry.kind,
        categoryId: entry.categoryId,
      })
      .from(statementLine)
      .leftJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .leftJoin(entry, eq(entry.id, entryPart.entryId))
      .where(and(eq(statementLine.accountId, accountId), eq(statementLine.source, "balance")))
      .orderBy(asc(statementLine.bookedOn)),
  );

const note = (accountId: string, day: string, balanceMinor: number) =>
  run(noteBalance(owner, accountId, day, balanceMinor));

test("each noted balance makes one movement line, an expense in the account's category", async () => {
  const meals = await categoryNamed("expense", "Restaurants");
  const card = await newAccount("Movement card", "benefit", "balance", meals);
  const current = await newAccount("Movement current", "current", "lines");
  const topUp = await lineOn(current, "2026-10-12", -5000);

  await note(card, "2026-09-30", 12_000);
  await run(pairLineWithAccount(owner, topUp, card));
  await note(card, "2026-10-31", 8000);

  // 0 → 120 is money that came in: an income, in its fallback (the account's category is an
  // expense one); 120 → 80 with 50 in is 90 spent, in the account's category.
  expect(await movementsOf(card)).toEqual([
    {
      bookedOn: "2026-09-30",
      amountMinor: 12_000,
      kind: "income",
      categoryId: await fallbackOf("income"),
    },
    { bookedOn: "2026-10-31", amountMinor: -9000, kind: "expense", categoryId: meals },
  ]);
});

test("a balance noted between two others, and an unpairing, make the movements again", async () => {
  const card = await newAccount("Remade card", "benefit", "balance");
  const current = await newAccount("Remade current", "current", "lines");
  const topUp = await lineOn(current, "2026-10-12", -4000);

  await note(card, "2026-09-30", 10_000);
  await note(card, "2026-10-31", 9000);
  await run(pairLineWithAccount(owner, topUp, card));

  expect((await movementsOf(card)).map((each) => each.amountMinor)).toEqual([10_000, -5000]);

  await note(card, "2026-10-15", 12_000);

  // 100 → 120 on the 15th with 40 in: 20 spent; 120 → 90 by the 31st: 30 spent.
  expect((await movementsOf(card)).map((each) => each.amountMinor)).toEqual([10_000, -2000, -3000]);

  await run(unpairLine(owner, topUp));

  // The side the app made on the card is gone: 100 → 120 is 20 that came in.
  expect((await movementsOf(card)).map((each) => [each.amountMinor, each.kind])).toEqual([
    [10_000, "income"],
    [2000, "income"],
    [-3000, "expense"],
  ]);
});

const settings = (name: string, change: Partial<AccountInput>): AccountInput => ({
  name,
  choice: "benefit",
  currency: "EUR",
  mode: "balance",
  openingBalanceMinor: 0,
  ...change,
});

test("the account's category moves its movements; kept by its lines, it has none", async () => {
  const meals = await categoryNamed("expense", "Restaurants");
  const card = await newAccount("Settings card", "benefit", "balance");

  await note(card, "2026-09-30", 6000);
  await note(card, "2026-10-31", 2500);

  expect((await movementsOf(card)).map((each) => each.categoryId)).toEqual([
    await fallbackOf("income"),
    await fallbackOf("expense"),
  ]);

  await run(editAccount(owner, card, settings("Settings card", { balanceCategoryId: meals })));

  expect((await movementsOf(card)).map((each) => each.categoryId)).toEqual([
    await fallbackOf("income"),
    meals,
  ]);

  // The opening balance shapes the first movement.
  await run(
    editAccount(
      owner,
      card,
      settings("Settings card", { balanceCategoryId: meals, openingBalanceMinor: 6000 }),
    ),
  );

  expect((await movementsOf(card)).map((each) => each.amountMinor)).toEqual([0, -3500]);

  await run(editAccount(owner, card, settings("Settings card", { mode: "lines" })));

  expect(await movementsOf(card)).toEqual([]);
});

test("making the movements again changes nothing once they agree", async () => {
  const card = await newAccount("Agreeing card", "benefit", "balance");

  await note(card, "2026-09-30", 7000);
  await note(card, "2026-10-31", 6500);

  const before = await movementsOf(card);

  await run(remakeEveryBalanceLine(owner));
  await run(remakeEveryBalanceLine(owner));

  expect(await movementsOf(card)).toEqual(before);
});

test("a movement in its fallback is to review, one in its account's category is not", async () => {
  const meals = await categoryNamed("expense", "Restaurants");
  const chosen = await newAccount("Reviewed card", "benefit", "balance", meals);
  const none = await newAccount("Unreviewed card", "benefit", "balance");

  for (const card of [chosen, none]) {
    await note(card, "2026-09-30", 4000);
    await note(card, "2026-10-31", 1000);
  }

  const toReview = await run(
    searchLines(owner, { toReview: true, from: "2026-10-31", to: "2026-10-31", limit: 500 }),
  );

  const accounts = toReview.lines.flatMap((line) => (line.fromBalance ? [line.account.id] : []));

  expect(accounts).toContain(none);
  expect(accounts).not.toContain(chosen);
});
