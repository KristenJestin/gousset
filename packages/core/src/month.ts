import type { Expense, MadeUpMonth } from "@gousset/fixture";
import { Effect } from "effect";

import { Ledger } from "./ledger";
import { today } from "./today";
import { addMonths } from "./values";
import type { SpendingGroup } from "./values";

// The month's figures, read for the web app's server functions and the MCP door alike: no caller
// computes a figure of its own (docs/architecture.md, "Calls between the interface and the server").

/** An amount in minor units (cents) of its currency: never a float. */
export type Money = { minor: number; currency: string };

/** The month in one bar (docs/vision.md, "Kinds of money movement"). */
export type MonthSummary = {
  month: string;
  /** Money that came in from outside: salary, meal vouchers. */
  received: Money;
  /** The categories of what came in, most first: "Salary", "Meal vouchers". */
  receivedFrom: ReadonlyArray<string>;
  /** The month's expenses, each at its net cost. */
  spent: Money;
  /** What was spent on average over the six months before; `null` when none can be read. */
  averageSpent: Money | null;
  /** Transfers to savings and investments. */
  setAside: Money;
  /** What is left once spent and set aside; negative when the month cost more than it brought. */
  left: Money;
  /**
   * The part of `left` that sits on benefit accounts (meal vouchers): yours, but restricted
   * (docs/vision.md, "Benefit accounts"). Never more than `left`, never negative.
   */
  restricted: Money;
  /** v0.1 reads made-up data only, and every screen says so. */
  madeUp: boolean;
};

export type SpendingRow = {
  name: string;
  amount: Money;
  /**
   * The benchmark: what this row averaged over the six months before (docs/vision.md, "Tracking,
   * not envelopes"); `null` when it never appeared in them.
   */
  benchmark: Money | null;
};

/**
 * Where the money goes: one row per category, merchant or subject, the largest first. An expense
 * counts in its rows once every line it is made of is approved; until then it counts in `pending`,
 * so that approving a line moves its amount into its row. By subject, an expense counts in full in
 * each of its subjects (docs/vision.md, "Subjects"), so rows may add up to more than `total`.
 */
export type Spending = {
  month: string;
  by: SpendingGroup;
  rows: ReadonlyArray<SpendingRow>;
  /** Expenses with a line still waiting in the review. */
  pending: Money;
  /** Every expense the grouping names, approved or pending, each counted once. */
  total: Money;
};

export type LineToReview = {
  id: string;
  bookedOn: string;
  /** The bank's raw label. */
  label: string;
  /** What the rules proposed. */
  merchant: string | null;
  category: string | null;
  account: string;
  amount: Money;
};

/** The lines the rules were not sure of, oldest first. */
export type LinesToReview = { month: string; count: number; lines: ReadonlyArray<LineToReview> };

/** The month's summary and where its money went: what the MCP `month` tool answers. */
export type MonthOverview = {
  summary: MonthSummary;
  byCategory: Spending;
  byMerchant: Spending;
};

/** Every made-up account is kept in euros; a currency per account comes with real accounts. */
const CURRENCY = "EUR";

/** How many months before a month its benchmarks and average are read from. */
export const BENCHMARK_MONTHS = 6;

export const money = (minor: number): Money => ({ minor, currency: CURRENCY });

export const read = (owner: string, month: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    return yield* ledger.month(owner, month);
  });

/** The `count` months before `month` that can be read, the closest first. */
export const readBefore = (owner: string, month: string, count: number) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    const months = yield* Effect.forEach(
      Array.from({ length: count }, (_, index) => addMonths(month, -(index + 1))),
      (before) =>
        ledger.month(owner, before).pipe(
          Effect.map((data): ReadonlyArray<MadeUpMonth> => [data]),
          Effect.catchTag("MonthOutOfRange", () => Effect.succeed([])),
        ),
    );

    return months.flat();
  });

/** The average of whole minor amounts, rounded to a whole minor unit. */
function average(amounts: ReadonlyArray<number>): number {
  return Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length);
}

/** What expenses cost, each at its net cost. */
const netOf = (expenses: ReadonlyArray<Expense>) =>
  expenses.reduce((sum, expense) => sum + expense.netMinor, 0);

const spentIn = (data: MadeUpMonth) => netOf(data.expenses);

function summarise(data: MadeUpMonth, before: ReadonlyArray<MadeUpMonth>): MonthSummary {
  const kindOf = new Map(data.accounts.map((account) => [account.id, account.kind]));
  const sources = new Map<string, number>();
  let received = 0;
  let setAside = 0;
  let onBenefitAccounts = 0;

  for (const line of data.lines) {
    const account = kindOf.get(line.accountId);

    if (line.kind === "income") {
      received += line.amountMinor;

      const source = line.category ?? line.merchant ?? "";

      sources.set(source, (sources.get(source) ?? 0) + line.amountMinor);
    }

    if (
      line.kind === "transfer" &&
      line.amountMinor > 0 &&
      (account === "savings" || account === "investment")
    ) {
      setAside += line.amountMinor;
    }

    if (account === "benefit") {
      onBenefitAccounts += line.amountMinor;
    }
  }

  const spent = spentIn(data);
  const left = received - spent - setAside;

  return {
    month: data.month,
    received: money(received),
    receivedFrom: [...sources]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([source]) => source),
    spent: money(spent),
    averageSpent: before.length === 0 ? null : money(average(before.map(spentIn))),
    setAside: money(setAside),
    left: money(left),
    restricted: money(Math.max(0, Math.min(left, onBenefitAccounts))),
    madeUp: true,
  };
}

/** The rows an expense counts in, for a grouping. */
function namesOf(expense: Expense, by: SpendingGroup): ReadonlyArray<string> {
  switch (by) {
    case "category": {
      return [expense.category];
    }

    case "merchant": {
      return [expense.merchant];
    }

    case "subject": {
      return expense.subjects;
    }
  }
}

function totalsBy(expenses: ReadonlyArray<Expense>, by: SpendingGroup): Map<string, number> {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    for (const name of namesOf(expense, by)) {
      totals.set(name, (totals.get(name) ?? 0) + expense.netMinor);
    }
  }

  return totals;
}

/** An expense with a payment or a refund still waiting in the review. */
function isPending(expense: Expense, waiting: ReadonlySet<string>): boolean {
  return [...expense.paymentLineIds, ...expense.refundLineIds].some((id) => waiting.has(id));
}

function group(data: MadeUpMonth, by: SpendingGroup, before: ReadonlyArray<MadeUpMonth>): Spending {
  const waiting = new Set(data.lines.flatMap((line) => (line.reviewed ? [] : [line.id])));
  const named = data.expenses.filter((expense) => namesOf(expense, by).length > 0);
  const approved = named.filter((expense) => !isPending(expense, waiting));
  const history = before.map((month) => totalsBy(month.expenses, by));

  const benchmark = (name: string) =>
    history.some((totals) => totals.has(name))
      ? money(average(history.map((totals) => totals.get(name) ?? 0)))
      : null;

  const rows = [...totalsBy(approved, by)]
    .map(([name, minor]) => ({ name, amount: money(minor), benchmark: benchmark(name) }))
    .sort((a, b) => b.amount.minor - a.amount.minor || a.name.localeCompare(b.name));

  return {
    month: data.month,
    by,
    rows,
    pending: money(netOf(named) - netOf(approved)),
    total: money(netOf(named)),
  };
}

/** One day of a month's spending, cumulative, in minor units; `null` where the day has none. */
export type SpendingDay = { date: string; current: number | null; previous: number | null };

/**
 * One row of "Where the money goes" day by day: what it had cost by each day of the month, against
 * the month before, as its spending chart draws it. Counts what its row counts: approved expenses.
 */
export type SpendingDays = {
  month: string;
  by: SpendingGroup;
  name: string;
  currency: string;
  days: ReadonlyArray<SpendingDay>;
};

/** The approved expenses of a row, as a running total by day of the month (index 0 is the 1st). */
function runningTotal(data: MadeUpMonth, by: SpendingGroup, name: string): Array<number> {
  const waiting = new Set(data.lines.flatMap((line) => (line.reviewed ? [] : [line.id])));
  const [year = 0, number = 1] = data.month.split("-").map(Number);
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const byDay = Array.from({ length }, () => 0);

  for (const expense of data.expenses) {
    if (namesOf(expense, by).includes(name) && !isPending(expense, waiting)) {
      const index = Number(expense.bookedOn.slice(8, 10)) - 1;

      byDay[index] = (byDay[index] ?? 0) + expense.netMinor;
    }
  }

  let total = 0;

  return byDay.map((amount) => (total += amount));
}

const withHistory = (owner: string, month: string) =>
  Effect.all([read(owner, month), readBefore(owner, month, BENCHMARK_MONTHS)]);

/** The month in one bar: received, spent, set aside, left, and the restricted part of left. */
export const monthSummary = (owner: string, month: string) =>
  Effect.map(withHistory(owner, month), ([data, before]) => summarise(data, before));

/** Where the money went in the month, by category, merchant or subject, with benchmarks. */
export const spending = (owner: string, month: string, by: SpendingGroup) =>
  Effect.map(withHistory(owner, month), ([data, before]) => group(data, by, before));

/** A row's spending, day by day, against the month before; nothing after today. */
export const spendingDays = (owner: string, month: string, by: SpendingGroup, name: string) =>
  Effect.gen(function* () {
    const data = yield* read(owner, month);
    const [before] = yield* readBefore(owner, month, 1);
    const day = yield* today;
    const current = runningTotal(data, by, name);
    const previous = before === undefined ? [] : runningTotal(before, by, name);

    const days = current.map((total, index): SpendingDay => {
      const date = `${data.month}-${String(index + 1).padStart(2, "0")}`;

      return { date, current: date > day ? null : total, previous: previous[index] ?? null };
    });

    return { month: data.month, by, name, currency: CURRENCY, days } satisfies SpendingDays;
  });

/** The month's summary with its spending by category and by merchant. */
export const monthOverview = (owner: string, month: string) =>
  Effect.map(withHistory(owner, month), ([data, before]): MonthOverview => ({
    summary: summarise(data, before),
    byCategory: group(data, "category", before),
    byMerchant: group(data, "merchant", before),
  }));

/** The month's lines waiting in the review. */
export const linesToReview = (owner: string, month: string) =>
  Effect.map(read(owner, month), (data): LinesToReview => {
    const accountName = new Map(data.accounts.map((account) => [account.id, account.name]));

    const lines = data.lines.flatMap((line) =>
      line.reviewed
        ? []
        : [
            {
              id: line.id,
              bookedOn: line.bookedOn,
              label: line.label,
              merchant: line.merchant,
              category: line.category,
              account: accountName.get(line.accountId) ?? line.accountId,
              amount: money(line.amountMinor),
            },
          ],
    );

    return { month: data.month, count: lines.length, lines };
  });

/**
 * Approves what the rules proposed for a line waiting in the review. Fails with `LineNotFound` or
 * `LineAlreadyReviewed` (reviewed elsewhere meanwhile).
 */
export const approveLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const line = yield* ledger.markReviewed(owner, lineId);

    return { id: line.id };
  });
