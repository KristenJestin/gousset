import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { AccountRecord } from "./account-store";
import type { AccountKind } from "./account-values";
import type { CategoryRecord } from "./category-store";
import { memoryCategory } from "./category-store-memory";
import { Expenses } from "./expenses/expenses";
import type { LineStore } from "./line-store";
import { memoryLineStore } from "./line-store-memory";
import type { MemoryLineRows } from "./line-store-memory";
import { merchantKey } from "./merchants/labels";
import { Merchants } from "./merchants/merchants";
import {
  MonthFacts,
  monthFlags,
  monthImportState,
  monthMovements,
  monthReview,
  monthSpending,
  monthSummary,
  spendingDays,
} from "./month";
import type {
  BenefitLine,
  MonthAccount,
  MonthMerchant,
  MonthPart,
  MonthScope,
  MonthTransfer,
  StatementReach,
} from "./month";
import type { Charge } from "./subscriptions/detection";
import { Today } from "./today";
import { Transfers } from "./transfers/transfers";

// The month read (#32): every figure computed from made-up rows, as `MonthFacts` would read them.
// Today is 2026-11-24; most tests read October, a month gone by.

const TODAY = "2026-11-24";

type Draft = {
  accounts: Array<MonthAccount>;
  categories: Array<CategoryRecord>;
  parts: Array<MonthPart>;
  transfers: Array<MonthTransfer>;
  merchants: Array<MonthMerchant>;
  aliases: Array<{ readonly alias: string; readonly merchantId: string }>;
  firstDay: string | null;
  benefitLines: Array<BenefitLine>;
  reach: Array<StatementReach>;
  charges: Array<Charge>;
  maybeRefunds: Array<string>;
};

let made = 0;

const nextId = (prefix: string) => {
  made += 1;

  return `${prefix}-${made}`;
};

function draft(): Draft {
  return {
    accounts: [],
    categories: [],
    parts: [],
    transfers: [],
    merchants: [],
    aliases: [],
    firstDay: "2025-01-05",
    benefitLines: [],
    reach: [],
    charges: [],
    maybeRefunds: [],
  };
}

function account(
  rows: Draft,
  name: string,
  kind: AccountKind,
  change: Partial<MonthAccount> = {},
): MonthAccount {
  const opened: MonthAccount = {
    id: nextId("account"),
    name,
    institution: null,
    kind,
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    creditOrder: "oldest_first",
    ...change,
  };

  rows.accounts.push(opened);

  return opened;
}

function category(
  rows: Draft,
  kind: "expense" | "income",
  name: string,
  change: Partial<CategoryRecord> = {},
) {
  const created = memoryCategory(kind, name, { position: rows.categories.length, ...change });

  rows.categories.push(created);

  return created;
}

function merchant(rows: Draft, name: string, label: string, intermediary = false) {
  const known: MonthMerchant = { id: nextId("merchant"), name, intermediary };

  rows.merchants.push(known);
  rows.aliases.push({ alias: merchantKey(label, null) ?? label, merchantId: known.id });

  return known;
}

type EntryDraft = {
  readonly kind?: "expense" | "income";
  readonly category: CategoryRecord;
  readonly account: MonthAccount;
  readonly day: string;
  readonly minor: number;
  readonly label?: string;
  readonly merchantId?: string;
  /** Refunds of it, on the same account. */
  readonly refunds?: ReadonlyArray<number>;
};

/** An entry of one payment line, and its refunds; the payment's line. */
function entry(rows: Draft, written: EntryDraft): string {
  const entryId = nextId("entry");

  const part = (role: "payment" | "refund", amountMinor: number): MonthPart => ({
    entryId,
    kind: written.kind ?? "expense",
    happenedOn: written.day,
    categoryId: written.category.id,
    entryMerchantId: written.merchantId ?? null,
    role,
    amountMinor,
    lineId: nextId("line"),
    label: written.label ?? "CARD PAYMENT",
    counterpartyName: null,
    accountId: written.account.id,
  });

  const payment = part("payment", written.minor);

  rows.parts.push(payment);

  for (const refund of written.refunds ?? []) {
    rows.parts.push(part("refund", refund));
  }

  return payment.lineId;
}

function transfer(
  rows: Draft,
  from: MonthAccount,
  to: MonthAccount,
  minor: number,
  outBookedOn: string,
  inBookedOn = outBookedOn,
) {
  rows.transfers.push({
    outAccountId: from.id,
    outBookedOn,
    outMinor: -minor,
    inAccountId: to.id,
    inBookedOn,
    inMinor: minor,
  });
}

function run<A, E>(
  effect: Effect.Effect<A, E, MonthFacts | LineStore | Transfers | Expenses | Merchants>,
  rows: Draft,
  day = TODAY,
  asked: Array<MonthScope> = [],
  lines: MemoryLineRows = {},
) {
  return Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        Layer.succeed(MonthFacts, {
          read: (_owner, scope) =>
            Effect.sync(() => {
              asked.push(scope);

              return rows;
            }),
        }),
        Layer.succeed(Today, { day: Effect.succeed(day) }),
        memoryLineStore(new Map([["ada", lines]])),
        // The review queue's proposals: no transfer waits, nothing comes back, no merchant known.
        Layer.mock(Transfers, {}),
        Layer.mock(Expenses, {}),
        Layer.mock(Merchants, {
          ofLine: () => Effect.succeed({ merchant: null, intermediary: null, asks: false }),
        }),
      ),
    ),
  );
}

/** A user with a current account, a savings account, salary and groceries. */
function household() {
  const rows = draft();
  const current = account(rows, "Current account", "current");
  const savings = account(rows, "Savings book", "savings");
  const salary = category(rows, "income", "Salary");
  const groceries = category(rows, "expense", "Groceries");

  return { rows, current, savings, salary, groceries };
}

describe("monthSummary", () => {
  test("received, spent, set aside and left, each at its net", async () => {
    const { rows, current, savings, salary, groceries } = household();

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 250_000,
    });

    // A refund lowers what was spent.
    entry(rows, {
      category: groceries,
      account: current,
      day: "2026-10-04",
      minor: 5000,
      refunds: [2000],
    });

    transfer(rows, current, savings, 50_000, "2026-10-05");
    transfer(rows, savings, current, 20_000, "2026-10-20");

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.received).toEqual({ minor: 250_000, currency: "EUR" });
    expect(summary.receivedFrom).toEqual([
      { categoryId: salary.id, name: "Salary", amount: { minor: 250_000, currency: "EUR" } },
    ]);
    expect(summary.spent).toEqual({ minor: 3000, currency: "EUR" });
    expect(summary.setAside).toEqual({ minor: 30_000, currency: "EUR" });
    expect(summary.left).toEqual({ minor: 217_000, currency: "EUR" });
    expect(summary.elsewhere).toEqual([]);
  });

  test("a line that may be a refund, not answered, is no income: it waits apart", async () => {
    const { rows, current, salary, groceries } = household();
    const other = category(rows, "income", "Other");

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 250_000,
    });

    entry(rows, {
      category: groceries,
      account: current,
      day: "2026-10-03",
      minor: 9000,
      label: "CARD PIXELPLAY STORE",
    });

    // PIXELPLAY sends 30.00 back: maybe a refund of the purchase, which still costs it all.
    rows.maybeRefunds.push(
      entry(rows, {
        kind: "income",
        category: other,
        account: current,
        day: "2026-10-04",
        minor: 3000,
        label: "CARD PIXELPLAY STORE",
      }),
    );

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.received).toEqual({ minor: 250_000, currency: "EUR" });
    expect(summary.receivedFrom.map((row) => row.name)).toEqual(["Salary"]);
    expect(summary.maybeRefunds).toEqual({ count: 1, amount: { minor: 3000, currency: "EUR" } });
    expect(summary.spent).toEqual({ minor: 9000, currency: "EUR" });
    expect(summary.left).toEqual({ minor: 241_000, currency: "EUR" });

    const { movements } = await run(monthMovements("ada", "2026-10", "EUR"), rows);

    expect(movements.map((each) => [each.kind, each.amount.minor, each.note])).toEqual([
      ["income", 250_000, "Salary"],
      ["maybe-refund", 3000, null],
    ]);
  });

  test("a month that takes more back from savings than it puts in sets aside less than nothing", async () => {
    const { rows, current, savings } = household();

    transfer(rows, current, savings, 10_000, "2026-10-05");
    transfer(rows, savings, current, 40_000, "2026-10-25");

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.setAside.minor).toBe(-30_000);
    expect(summary.left.minor).toBe(30_000);
  });

  test("a transfer between two savings or investment accounts sets nothing aside", async () => {
    const { rows, savings } = household();
    const broker = account(rows, "Broker", "investment");

    transfer(rows, savings, broker, 100_000, "2026-10-10");

    expect((await run(monthSummary("ada", "2026-10", "EUR"), rows)).setAside.minor).toBe(0);
  });

  test("a transfer counts by the day of its side on the savings account", async () => {
    const { rows, current, savings } = household();

    // Out in October, in on the savings account at the next fortnight, in November.
    transfer(rows, current, savings, 10_000, "2026-10-30", "2026-11-01");
    // Out in September, in on the savings account in October.
    transfer(rows, current, savings, 7000, "2026-09-29", "2026-10-01");

    expect((await run(monthSummary("ada", "2026-10", "EUR"), rows)).setAside.minor).toBe(7000);
  });

  test("a works council's funding does not lower what was spent, nor is it set aside", async () => {
    const { rows, current, groceries } = household();
    const council = account(rows, "Works council", "benefit");

    entry(rows, { category: groceries, account: current, day: "2026-10-04", minor: 8000 });
    // The council's refund: a transfer that funds the expense, which keeps its cost.
    transfer(rows, council, current, 3000, "2026-10-12");

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.spent.minor).toBe(8000);
    expect(summary.setAside.minor).toBe(0);
  });

  test("other currencies are given apart, never converted", async () => {
    const { rows, current, salary, groceries } = household();
    const dollars = account(rows, "Travel card", "current", { currency: "USD" });

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 100_000,
    });

    entry(rows, { category: groceries, account: current, day: "2026-10-04", minor: 4000 });
    entry(rows, { category: groceries, account: dollars, day: "2026-10-06", minor: 2500 });

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.spent).toEqual({ minor: 4000, currency: "EUR" });
    expect(summary.left).toEqual({ minor: 96_000, currency: "EUR" });
    expect(summary.elsewhere).toEqual([
      {
        currency: "USD",
        received: { minor: 0, currency: "USD" },
        maybeRefunds: { minor: 0, currency: "USD" },
        spent: { minor: 2500, currency: "USD" },
        setAside: { minor: 0, currency: "USD" },
        left: { minor: -2500, currency: "USD" },
      },
    ]);
  });

  test("spent against the average of the months counted and the month before", async () => {
    const { rows, current, groceries } = household();

    for (const month of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      entry(rows, { category: groceries, account: current, day: `${month}-10`, minor: 6000 });
    }

    entry(rows, { category: groceries, account: current, day: "2026-09-20", minor: 3000 });
    entry(rows, { category: groceries, account: current, day: "2026-10-02", minor: 1000 });

    const asked: Array<MonthScope> = [];
    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows, TODAY, asked);

    expect(summary.monthsAveraged).toBe(6);
    expect(summary.averageSpent).toEqual({ minor: 6500, currency: "EUR" });
    expect(summary.previousSpent).toEqual({ minor: 9000, currency: "EUR" });
    expect(asked).toEqual([
      {
        entries: { from: "2026-04-01", to: "2026-10-31" },
        transfers: { from: "2026-10-01", to: "2026-10-31" },
        maybeRefunds: { from: "2026-10-01", to: "2026-10-31" },
        benefitTo: TODAY,
        statementsTo: TODAY,
        charges: null,
      },
    ]);
  });

  test("a new user's average counts only the months since their first entry", async () => {
    const { rows, current, groceries } = household();

    rows.firstDay = "2026-08-14";
    entry(rows, { category: groceries, account: current, day: "2026-08-14", minor: 3000 });
    entry(rows, { category: groceries, account: current, day: "2026-09-14", minor: 5000 });

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(summary.monthsAveraged).toBe(2);
    expect(summary.averageSpent?.minor).toBe(4000);

    const newcomer = await run(monthSummary("ada", "2026-10", "EUR"), {
      ...rows,
      parts: [],
      firstDay: "2026-10-03",
    });

    expect(newcomer.monthsAveraged).toBe(0);
    expect(newcomer.averageSpent).toBeNull();
    expect(newcomer.previousSpent).toBeNull();
  });

  test("the restricted part of left is what sits on benefit accounts, never more than left", async () => {
    const { rows, current, salary, groceries } = household();
    const meals = account(rows, "Meal card", "benefit");

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 10_000,
    });

    entry(rows, {
      kind: "income",
      category: salary,
      account: meals,
      day: "2026-10-02",
      minor: 15_000,
    });

    rows.benefitLines.push({
      accountId: meals.id,
      id: "credit",
      bookedOn: "2026-10-02",
      amountMinor: 15_000,
      label: "MEAL CREDIT",
      expiresOn: null,
    });

    entry(rows, { category: groceries, account: current, day: "2026-10-05", minor: 20_000 });

    const clamped = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(clamped.left.minor).toBe(5000);
    expect(clamped.restricted.minor).toBe(5000);

    entry(rows, { category: groceries, account: current, day: "2026-10-06", minor: 9000 });

    const overspent = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    expect(overspent.left.minor).toBe(-4000);
    expect(overspent.restricted.minor).toBe(0);
  });

  test("a maybe refund on a benefit card is no more restricted than it is received", async () => {
    const { rows, current, salary, groceries } = household();
    const meals = account(rows, "Meal card", "benefit");

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 100_000,
    });
    entry(rows, {
      kind: "income",
      category: salary,
      account: meals,
      day: "2026-10-02",
      minor: 10_000,
    });
    entry(rows, {
      category: groceries,
      account: meals,
      day: "2026-10-03",
      minor: 3000,
      label: "CARD BISTRO EXEMPLE",
    });

    const back = entry(rows, {
      kind: "income",
      category: salary,
      account: meals,
      day: "2026-10-04",
      minor: 3000,
      label: "CARD BISTRO EXEMPLE",
    });

    rows.maybeRefunds.push(back);

    for (const [id, bookedOn, amountMinor] of [
      ["credit", "2026-10-02", 10_000],
      ["meal", "2026-10-03", -3000],
      [back, "2026-10-04", 3000],
    ] as const) {
      rows.benefitLines.push({
        accountId: meals.id,
        id,
        bookedOn,
        amountMinor,
        label: "MEALS",
        expiresOn: null,
      });
    }

    const summary = await run(monthSummary("ada", "2026-10", "EUR"), rows);

    // Left counts 107,000, of which 7,000 sits on the card: the 30.00 back waits apart.
    expect(summary.left.minor).toBe(107_000);
    expect(summary.restricted.minor).toBe(7000);
  });

  test("a month to come is refused", async () => {
    const error = await run(Effect.flip(monthSummary("ada", "2026-12", "EUR")), draft());

    expect(error._tag).toBe("FutureMonthRefused");
  });
});

describe("monthSpending", () => {
  test("by category: top-level rows with their children, benchmarks, drifts, average and month before", async () => {
    const { rows, current, groceries } = household();
    const bakery = category(rows, "expense", "Bakery", { parentId: groceries.id });

    const leisure = category(rows, "expense", "Leisure", {
      benchmark: { mode: "fixed", minor: 5000 },
    });

    entry(rows, { category: groceries, account: current, day: "2026-09-10", minor: 12_000 });
    entry(rows, { category: groceries, account: current, day: "2026-10-10", minor: 10_000 });
    entry(rows, { category: bakery, account: current, day: "2026-10-11", minor: 3000 });
    entry(rows, { category: leisure, account: current, day: "2026-10-12", minor: 30_000 });

    const read = await run(monthSpending("ada", "2026-10", "EUR", "category"), rows);
    const [first, second] = read.by === "category" ? read.rows : [];

    expect(read.monthsAveraged).toBe(6);
    expect(first?.name).toBe("Leisure");
    expect(first?.drifts).toBe(true);
    expect(first?.benchmark).toEqual({ mode: "fixed", amount: { minor: 5000, currency: "EUR" } });
    expect(second?.name).toBe("Groceries");
    expect(second?.spent.minor).toBe(13_000);
    expect(second?.previous?.minor).toBe(12_000);
    expect(second?.average?.minor).toBe(2000);
    expect(second?.children.map((child) => [child.name, child.spent.minor])).toEqual([
      ["Bakery", 3000],
    ]);
  });

  test("by merchant: its own merchant, else its lines', an intermediary kept, none last", async () => {
    const { rows, current, groceries } = household();
    const market = merchant(rows, "Greenmarket", "GREENMARKET");
    const paypal = merchant(rows, "PayPal", "PAYPAL", true);
    const pixel = merchant(rows, "Pixelplay", "PIXELPLAY");
    const day = (date: string) => ({ category: groceries, account: current, day: date });

    // Its own merchant, behind the intermediary (#30).
    entry(rows, { ...day("2026-10-02"), minor: 1500, label: "PAYPAL", merchantId: pixel.id });
    // An intermediary of its own is no one paid: its line's merchant counts.
    entry(rows, { ...day("2026-10-03"), minor: 2000, label: "GREENMARKET", merchantId: paypal.id });
    // Only the intermediary is known.
    entry(rows, { ...day("2026-10-04"), minor: 900, label: "PAYPAL" });
    // A line no merchant's label names.
    entry(rows, { ...day("2026-10-05"), minor: 99_000, label: "UNKNOWN SHOP" });
    entry(rows, { ...day("2026-09-05"), minor: 1000, label: "GREENMARKET" });

    const read = await run(monthSpending("ada", "2026-10", "EUR", "merchant"), rows);

    expect(
      read.by === "merchant"
        ? read.rows.map((row) => [row.name, row.intermediary, row.spent.minor, row.previous?.minor])
        : [],
    ).toEqual([
      ["Greenmarket", false, 2000, 1000],
      ["Pixelplay", false, 1500, 0],
      ["PayPal", true, 900, 0],
      [null, false, 99_000, 0],
    ]);

    expect(read.rows.at(0)?.id).toBe(market.id);
  });
});

describe("spendingDays", () => {
  test("a category day by day against the month before, nothing after today", async () => {
    const { rows, current, groceries } = household();

    entry(rows, { category: groceries, account: current, day: "2026-10-02", minor: 1000 });
    entry(rows, { category: groceries, account: current, day: "2026-11-02", minor: 400 });
    entry(rows, { category: groceries, account: current, day: "2026-11-20", minor: 600 });

    const read = await run(spendingDays("ada", "2026-11", "EUR", "category", groceries.id), rows);

    expect(read.name).toBe("Groceries");
    expect(read.days).toHaveLength(30);
    expect(read.days[0]).toEqual({ date: "2026-11-01", current: 0, previous: 0 });
    expect(read.days[1]).toEqual({ date: "2026-11-02", current: 400, previous: 1000 });
    expect(read.days[23]).toEqual({ date: "2026-11-24", current: 1000, previous: 1000 });
    expect(read.days[24]).toEqual({ date: "2026-11-25", current: null, previous: 1000 });
  });
});

describe("monthMovements", () => {
  test("incomes and transfers in, oldest first, an institution only where two accounts share a name", async () => {
    const rows = draft();
    const north = account(rows, "Current account", "current", { institution: "Northbank" });
    const south = account(rows, "Current account", "current", { institution: "Southbank" });
    const savings = account(rows, "Savings book", "savings", { institution: "Northbank" });
    const salary = category(rows, "income", "Salary");

    transfer(rows, north, savings, 30_000, "2026-10-03");

    const payroll = entry(rows, {
      kind: "income",
      category: salary,
      account: south,
      day: "2026-10-01",
      minor: 200_000,
      label: "ACME PAYROLL",
    });

    transfer(rows, south, north, 5000, "2026-09-30", "2026-10-01");

    const { movements } = await run(monthMovements("ada", "2026-10", "EUR"), rows);

    expect(movements).toEqual([
      {
        kind: "income",
        day: "2026-10-01",
        from: "ACME PAYROLL",
        to: "Current account (Southbank)",
        note: "Salary",
        lineId: payroll,
        amount: { minor: 200_000, currency: "EUR" },
      },
      {
        kind: "transfer",
        day: "2026-10-01",
        from: "Current account (Southbank)",
        to: "Current account (Northbank)",
        note: null,
        lineId: null,
        amount: { minor: 5000, currency: "EUR" },
      },
      {
        kind: "transfer",
        day: "2026-10-03",
        from: "Current account (Northbank)",
        to: "Savings book",
        note: null,
        lineId: null,
        amount: { minor: 30_000, currency: "EUR" },
      },
    ]);
  });
});

describe("monthImportState", () => {
  test("the open accounts kept by lines, those whose statements reach the month's end, how far the others go", async () => {
    const rows = draft();
    const current = account(rows, "Current account", "current");
    const card = account(rows, "Card", "card");
    const fresh = account(rows, "New account", "current");

    account(rows, "House", "investment", { mode: "balance" });
    account(rows, "Old account", "current", { closedOn: "2026-09-30" });
    account(rows, "Later account", "current", { openedOn: "2026-11-02" });

    rows.reach.push(
      { accountId: current.id, importedTo: "2026-11-03", statementTo: null },
      { accountId: card.id, importedTo: null, statementTo: "2026-10-20" },
      { accountId: fresh.id, importedTo: null, statementTo: null },
    );

    const state = await run(monthImportState("ada", "2026-10", "EUR"), rows);

    expect(state).toEqual({
      month: "2026-10",
      expected: "2026-10-31",
      accounts: 3,
      imported: 1,
      partial: [
        { accountId: card.id, account: "Card", reached: "2026-10-20" },
        { accountId: fresh.id, account: "New account", reached: null },
      ],
    });

    // In the month under way, statements reach today.
    rows.reach.splice(0, 1, { accountId: current.id, importedTo: TODAY, statementTo: null });

    const underway = await run(monthImportState("ada", "2026-11", "EUR"), rows);

    expect(underway.expected).toBe(TODAY);
    expect(underway.partial.map((each) => each.account)).toEqual([
      "Card",
      "Later account",
      "New account",
    ]);
  });

  test("an account closed during the month is imported once its statements reach its closing", async () => {
    const rows = draft();
    const closing = account(rows, "Closed account", "current", { closedOn: "2026-10-15" });

    rows.reach.push({ accountId: closing.id, importedTo: "2026-10-15", statementTo: null });

    const state = await run(monthImportState("ada", "2026-10", "EUR"), rows);

    expect(state).toEqual({
      month: "2026-10",
      expected: "2026-10-31",
      accounts: 1,
      imported: 1,
      partial: [],
    });

    rows.reach.splice(0, 1, { accountId: closing.id, importedTo: "2026-10-14", statementTo: null });

    const short = await run(monthImportState("ada", "2026-10", "EUR"), rows);

    expect(short.partial).toEqual([
      { accountId: closing.id, account: "Closed account", reached: "2026-10-14" },
    ]);
  });
});

/** A charge of a merchant, for the subscriptions read. */
function charge(merchantName: string, day: string, amountMinor: number): Charge {
  return {
    id: nextId("charge"),
    merchantId: `merchant-${merchantName}`,
    merchant: merchantName,
    day,
    amountMinor,
    currency: "EUR",
  };
}

describe("monthFlags", () => {
  test("drifts, price rises, stops, expiring credits and accounts not imported, in that order", async () => {
    const { rows, current, savings, groceries } = household();
    const meals = account(rows, "Meal card", "benefit");

    const leisure = category(rows, "expense", "Leisure", {
      benchmark: { mode: "fixed", minor: 1000 },
    });

    entry(rows, { category: leisure, account: current, day: "2026-10-12", minor: 3000 });
    entry(rows, { category: groceries, account: current, day: "2026-10-13", minor: 3000 });

    rows.charges.push(
      ...["2026-06-08", "2026-07-08", "2026-08-08", "2026-09-08"].map((day) =>
        charge("Streamly", day, 949),
      ),
      charge("Streamly", "2026-10-08", 1099),
      ...["2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"].map((day) =>
        charge("Fitclub", day, 2900),
      ),
    );

    const line = (id: string, bookedOn: string, amountMinor: number, expiresOn: string | null) => ({
      accountId: meals.id,
      id,
      bookedOn,
      amountMinor,
      label: "MEAL CARD",
      expiresOn,
    });

    rows.benefitLines.push(
      line("c1", "2026-09-01", 10_000, "2026-11-30"),
      line("p1", "2026-10-05", -3000, null),
      line("c2", "2026-10-06", 5000, "2027-03-31"),
    );

    rows.reach.push(
      { accountId: current.id, importedTo: "2026-10-31", statementTo: null },
      { accountId: meals.id, importedTo: "2026-10-31", statementTo: null },
      { accountId: savings.id, importedTo: null, statementTo: "2026-10-15" },
    );

    const asked: Array<MonthScope> = [];
    const { flags } = await run(monthFlags("ada", "2026-10", "EUR"), rows, TODAY, asked);

    expect(asked.at(0)?.charges).toEqual({ from: "2023-10-31", to: "2026-10-31" });
    expect(flags.map((flag) => flag.kind)).toEqual([
      "drift",
      "price-rise",
      "stopped",
      "expiring",
      "not-imported",
    ]);
    expect(flags).toContainEqual({
      kind: "drift",
      categoryId: leisure.id,
      name: "Leisure",
      spent: { minor: 3000, currency: "EUR" },
      benchmark: { minor: 1000, currency: "EUR" },
    });
    expect(flags).toContainEqual({
      kind: "price-rise",
      merchant: "Streamly",
      from: { minor: 949, currency: "EUR" },
      to: { minor: 1099, currency: "EUR" },
    });
    expect(flags).toContainEqual(expect.objectContaining({ kind: "stopped", merchant: "Fitclub" }));
    expect(flags).toContainEqual({
      kind: "expiring",
      accountId: meals.id,
      account: "Meal card",
      day: "2026-11-30",
      amount: { minor: 7000, currency: "EUR" },
    });
    expect(flags).toContainEqual({
      kind: "not-imported",
      accountId: savings.id,
      account: "Savings book",
      reached: "2026-10-15",
    });
  });
});

describe("monthReview", () => {
  test("every block at once, from one read of the month's rows", async () => {
    const { rows, current, salary, groceries } = household();

    entry(rows, {
      kind: "income",
      category: salary,
      account: current,
      day: "2026-10-01",
      minor: 100_000,
    });

    entry(rows, { category: groceries, account: current, day: "2026-10-04", minor: 4000 });

    const asked: Array<MonthScope> = [];
    const review = await run(monthReview("ada", "2026-10", "EUR"), rows, TODAY, asked);

    expect(asked).toHaveLength(1);
    expect(review.summary.left.minor).toBe(96_000);
    expect(review.categories.rows.at(0)?.name).toBe("Groceries");
    expect(review.merchants.rows).toHaveLength(1);
    expect(review.movements.movements).toHaveLength(1);
    expect(review.linesToReview).toEqual({
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-10-31",
      count: 0,
      lines: [],
    });
    expect(review.importState.accounts).toBe(2);
  });

  test("the lines to review are the review queue's, booked in the month, newest first", async () => {
    const { rows, current } = household();

    const record: AccountRecord = {
      ...current,
      envelope: null,
      settlesIntoAccountId: null,
      balanceCategoryId: null,
      topUpDays: 3,
      topUpCapMinor: null,
    };

    const other = { id: "other", name: "Other", parentName: null, kind: "expense" as const };

    const line = (
      id: string,
      bookedOn: string,
      classifiedBy: "default" | "rule",
      maybeRefund = false,
    ) => ({
      id,
      accountId: current.id,
      bookedOn,
      valueOn: null,
      amountMinor: -1500,
      label: `CARD ${id.toUpperCase()}`,
      memo: null,
      counterpartyName: null,
      classifiedBy,
      category: other,
      maybeRefund,
    });

    const lines: MemoryLineRows = {
      accounts: [record],
      lines: [
        // Maybe a refund (#208): the review says so.
        line("early", "2026-10-02", "default", true),
        line("late", "2026-10-20", "default"),
        // A rule's choice is the user's: never to review.
        line("ruled", "2026-10-21", "rule"),
        // Booked in the month after.
        line("next", "2026-11-02", "default"),
      ],
    };

    const review = await run(monthReview("ada", "2026-10", "EUR"), rows, TODAY, [], lines);

    expect(review.linesToReview.count).toBe(2);
    expect(review.linesToReview.lines).toEqual([
      {
        id: "late",
        day: "2026-10-20",
        label: "CARD LATE",
        category: other,
        account: expect.objectContaining({ name: "Current account" }),
        amount: { minor: -1500, currency: "EUR" },
        maybeRefund: false,
      },
      expect.objectContaining({ id: "early", day: "2026-10-02", maybeRefund: true }),
    ]);
  });
});
