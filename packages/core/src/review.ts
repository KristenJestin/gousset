import type { Expense, MadeUpMonth } from "@gousset/fixture";
import { Effect } from "effect";

import { money, read, readBefore } from "./month";
import type { Money } from "./month";
import { today } from "./today";

// The other blocks of the monthly review (docs/wireframes, screen 1): the movements between the
// user's accounts, the investments, the state of the imports and what is flagged.

/**
 * One movement of the month, "from → to": money coming in from outside, or moving between two of
 * the user's accounts. A transfer to an investment account followed by a purchase of securities
 * there carries what was bought, so that both fit on one line.
 */
export type Movement = {
  /** The id of the line the money arrived on. */
  id: string;
  bookedOn: string;
  kind: "income" | "transfer";
  /** Who paid (an income), or the account the money left. */
  from: string;
  /** The account the money arrived on. */
  to: string;
  /** What an income is, as its category says: "Salary". */
  note: string | null;
  amount: Money;
  /** The securities bought with it on the investment account, and for how much. */
  bought: { name: string; amount: Money } | null;
};

export type Movements = { month: string; movements: ReadonlyArray<Movement> };

/** An investment account on the day the month's positions stand on (docs/vision.md, "Investments"). */
export type InvestmentAccount = {
  account: string;
  value: Money;
  /** What came out of the user's pocket into it so far. */
  netContributions: Money;
  /** `value − netContributions`. */
  gain: Money;
};

export type Investments = {
  month: string;
  /** The day the values stand on: the month's last day, or today in the month under way. */
  asOf: string;
  accounts: ReadonlyArray<InvestmentAccount>;
};

/** An account whose imported statement stops before the day it should reach. */
export type PartialImport = { account: string; coveredTo: string };

/**
 * How far the month's statements were imported. An account is imported when its statement covers
 * the month to its end, or to today in the month under way.
 */
export type ImportState = {
  month: string;
  accounts: number;
  imported: number;
  partial: ReadonlyArray<PartialImport>;
};

/** Something the review points out (docs/wireframes, screen 1, block 6). */
export type Flag =
  | {
      kind: "price-change";
      /** A merchant charged the same amount each of the three months before, and another now. */
      merchant: string;
      before: Money;
      now: Money;
    }
  | { kind: "not-imported"; account: string; coveredTo: string };

export type Flags = { month: string; flags: ReadonlyArray<Flag> };

/** How many months a merchant must have charged the same amount to count as recurring. */
const RECURRING_MONTHS = 3;

function accountNames(data: MadeUpMonth) {
  return new Map(data.accounts.map((account) => [account.id, account.name]));
}

function movementsOf(data: MadeUpMonth): ReadonlyArray<Movement> {
  const names = accountNames(data);
  const kindOf = new Map(data.accounts.map((account) => [account.id, account.kind]));
  const lineById = new Map(data.lines.map((line) => [line.id, line]));
  const name = (accountId: string) => names.get(accountId) ?? accountId;

  return data.lines.flatMap((line): ReadonlyArray<Movement> => {
    if (line.kind === "income") {
      return [
        {
          id: line.id,
          bookedOn: line.bookedOn,
          kind: "income",
          from: line.merchant ?? line.label,
          to: name(line.accountId),
          note: line.category,
          amount: money(line.amountMinor),
          bought: null,
        },
      ];
    }

    // A transfer is told once, from the side it arrives on.
    if (line.kind !== "transfer" || line.amountMinor <= 0) {
      return [];
    }

    const source =
      line.counterpartLineId === null ? undefined : lineById.get(line.counterpartLineId);

    const purchase =
      kindOf.get(line.accountId) === "investment"
        ? data.lines.find(
            (other) =>
              other.kind === "purchase" &&
              other.accountId === line.accountId &&
              other.bookedOn >= line.bookedOn,
          )
        : undefined;

    const bought =
      purchase === undefined
        ? null
        : {
            name:
              data.investments.find((position) => position.accountId === line.accountId)?.name ??
              purchase.label,
            amount: money(-purchase.amountMinor),
          };

    return [
      {
        id: line.id,
        bookedOn: line.bookedOn,
        kind: "transfer",
        from: source === undefined ? line.label : name(source.accountId),
        to: name(line.accountId),
        note: null,
        amount: money(line.amountMinor),
        bought,
      },
    ];
  });
}

/** The month's movements: what came in, and what moved between the user's accounts. */
export const movements = (owner: string, month: string) =>
  Effect.map(read(owner, month), (data): Movements => ({
    month: data.month,
    movements: movementsOf(data),
  }));

/**
 * Each investment account's value, net contributions and gain at the end of the month, or as they
 * stand today in the month under way.
 */
export const investments = (owner: string, month: string) =>
  Effect.gen(function* () {
    const data = yield* read(owner, month);
    const day = yield* today;
    const names = accountNames(data);
    const byAccount = new Map<string, { value: number; contributions: number }>();

    for (const position of data.investments) {
      const sums = byAccount.get(position.accountId) ?? { value: 0, contributions: 0 };

      byAccount.set(position.accountId, {
        value: sums.value + position.valueMinor,
        contributions: sums.contributions + position.netContributionsMinor,
      });
    }

    return {
      month: data.month,
      asOf: expectedEnd(data.month, day),
      accounts: [...byAccount].map(([accountId, sums]) => ({
        account: names.get(accountId) ?? accountId,
        value: money(sums.value),
        netContributions: money(sums.contributions),
        gain: money(sums.value - sums.contributions),
      })),
    } satisfies Investments;
  });

/** The day the month's statements should reach: its last day, or today in the month under way. */
function expectedEnd(month: string, day: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);

  return last < day ? last : day;
}

function partialImports(data: MadeUpMonth, day: string): ReadonlyArray<PartialImport> {
  const names = accountNames(data);
  const end = expectedEnd(data.month, day);

  return data.statements.flatMap((statement) =>
    statement.coveredTo < end
      ? [
          {
            account: names.get(statement.accountId) ?? statement.accountId,
            coveredTo: statement.coveredTo,
          },
        ]
      : [],
  );
}

/** How far the month's statements were imported, account by account. */
export const importState = (owner: string, month: string) =>
  Effect.gen(function* () {
    const data = yield* read(owner, month);
    const day = yield* today;
    const partial = partialImports(data, day);

    return {
      month: data.month,
      accounts: data.statements.length,
      imported: data.statements.length - partial.length,
      partial,
    } satisfies ImportState;
  });

/** What a merchant was charged in a month, when it was charged exactly once. */
function chargedOnce(expenses: ReadonlyArray<Expense>, lines: MadeUpMonth["lines"]) {
  const amountOf = new Map(lines.map((line) => [line.id, line.amountMinor]));
  const charges = new Map<string, Array<number>>();

  for (const expense of expenses) {
    const paid = -expense.paymentLineIds.reduce((sum, id) => sum + (amountOf.get(id) ?? 0), 0);
    const known = charges.get(expense.merchant) ?? [];

    known.push(paid);
    charges.set(expense.merchant, known);
  }

  return new Map(
    [...charges].flatMap(([merchant, paid]) =>
      paid.length === 1 && paid[0] !== undefined ? [[merchant, paid[0]] as const] : [],
    ),
  );
}

/**
 * A merchant charged once a month, the same amount each of the three months before, and another
 * amount this month: a subscription whose price changed.
 */
function priceChanges(data: MadeUpMonth, before: ReadonlyArray<MadeUpMonth>): ReadonlyArray<Flag> {
  if (before.length < RECURRING_MONTHS) {
    return [];
  }

  const now = chargedOnce(data.expenses, data.lines);
  const history = before.map((month) => chargedOnce(month.expenses, month.lines));

  return [...now].flatMap(([merchant, paid]): ReadonlyArray<Flag> => {
    const earlier = new Set(history.map((charges) => charges.get(merchant)));
    const [usual] = earlier;

    return earlier.size === 1 && usual !== undefined && usual !== paid
      ? [{ kind: "price-change", merchant, before: money(usual), now: money(paid) }]
      : [];
  });
}

/** What the review points out: a recurring price that changed, an account not imported. */
export const flags = (owner: string, month: string) =>
  Effect.gen(function* () {
    const data = yield* read(owner, month);
    const before = yield* readBefore(owner, month, RECURRING_MONTHS);
    const day = yield* today;

    const notImported = partialImports(data, day).map((partial): Flag => ({
      kind: "not-imported",
      ...partial,
    }));

    return {
      month: data.month,
      flags: [...priceChanges(data, before), ...notImported],
    } satisfies Flags;
  });
