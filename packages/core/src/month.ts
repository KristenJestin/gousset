import type { MadeUpMonth } from "@gousset/fixture";
import { Effect, Schema } from "effect";

import { Ledger } from "./ledger";

// The month's figures, read for the web app's server functions and the MCP door alike: no caller
// computes a figure of its own (docs/architecture.md, "Calls between the interface and the server").

/** `YYYY-MM`. */
export const Month = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: "A month is written YYYY-MM, as 2026-10.",
  }),
);

/** What spending is grouped by. */
export const SpendingGroup = Schema.Literals(["category", "merchant"]);

export type SpendingGroup = typeof SpendingGroup.Type;

/** An amount in minor units (cents) of its currency: never a float. */
export type Money = { minor: number; currency: string };

/** The month in one bar (docs/vision.md, "Kinds of money movement"). */
export type MonthSummary = {
  month: string;
  /** Money that came in from outside: salary, meal vouchers. */
  received: Money;
  /** The month's expenses, each at its net cost. */
  spent: Money;
  /** Transfers to savings and investments. */
  setAside: Money;
  /** What is left once spent and set aside; negative when the month cost more than it brought. */
  left: Money;
  /** v0.1 reads made-up data only, and every screen says so. */
  madeUp: boolean;
};

export type SpendingRow = { name: string; amount: Money };

/** Where the money goes: one row per category or merchant, the largest first. */
export type Spending = {
  month: string;
  by: SpendingGroup;
  rows: ReadonlyArray<SpendingRow>;
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

const money = (minor: number): Money => ({ minor, currency: CURRENCY });

function summarise(data: MadeUpMonth): MonthSummary {
  const kindOf = new Map(data.accounts.map((account) => [account.id, account.kind]));
  let received = 0;
  let setAside = 0;

  for (const line of data.lines) {
    if (line.kind === "income") {
      received += line.amountMinor;
    }

    const destination = kindOf.get(line.accountId);

    if (
      line.kind === "transfer" &&
      line.amountMinor > 0 &&
      (destination === "savings" || destination === "investment")
    ) {
      setAside += line.amountMinor;
    }
  }

  const spent = data.expenses.reduce((sum, expense) => sum + expense.netMinor, 0);

  return {
    month: data.month,
    received: money(received),
    spent: money(spent),
    setAside: money(setAside),
    left: money(received - spent - setAside),
    madeUp: true,
  };
}

function group(data: MadeUpMonth, by: SpendingGroup): Spending {
  const totals = new Map<string, number>();

  for (const expense of data.expenses) {
    const name = by === "category" ? expense.category : expense.merchant;

    totals.set(name, (totals.get(name) ?? 0) + expense.netMinor);
  }

  const rows = [...totals]
    .map(([name, minor]) => ({ name, amount: money(minor) }))
    .sort((a, b) => b.amount.minor - a.amount.minor || a.name.localeCompare(b.name));

  return {
    month: data.month,
    by,
    rows,
    total: money(rows.reduce((sum, row) => sum + row.amount.minor, 0)),
  };
}

const read = (owner: string, month: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    return yield* ledger.month(owner, month);
  });

/** The month in one bar: received, spent, set aside, left. */
export const monthSummary = (owner: string, month: string) =>
  Effect.map(read(owner, month), summarise);

/** Where the money went in the month, by category or by merchant. */
export const spending = (owner: string, month: string, by: SpendingGroup) =>
  Effect.map(read(owner, month), (data) => group(data, by));

/** The month's summary with its spending by category and by merchant. */
export const monthOverview = (owner: string, month: string) =>
  Effect.map(read(owner, month), (data): MonthOverview => ({
    summary: summarise(data),
    byCategory: group(data, "category"),
    byMerchant: group(data, "merchant"),
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
