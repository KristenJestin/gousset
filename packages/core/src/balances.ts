import { ACCOUNT_GROUPS, groupOf } from "./account-values";
import type { AccountGroup, AccountKind, AccountMode } from "./account-values";
import type { Money } from "./month";

// The dense pure logic of the accounts: balances at the end of a day, day by day and after each
// line, the groups and their totals per currency, and the check against a statement. Every figure
// is computed on read from these, never stored (docs/data-model.md, "Open choices").

/** A balance at the end of a day, in minor units of the account's currency. */
export type DayBalance = { readonly day: string; readonly minor: number };

/** The day `count` days after `day` (before, when negative), both `YYYY-MM-DD`. */
export function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + count);

  return date.toISOString().slice(0, 10);
}

/** How many days run from `from` to `to`, both included: 1 for the same day. */
export function daysFrom(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

/** The latest of balances (oldest first) on or before `day`, if any. */
function latestBy(balances: ReadonlyArray<DayBalance>, day: string): DayBalance | undefined {
  let latest: DayBalance | undefined;

  for (const balance of balances) {
    if (balance.day > day) {
      break;
    }

    latest = balance;
  }

  return latest;
}

/**
 * What an account holds at the end of `day`. Kept by its lines: the opening balance plus every
 * counted line booked up to that day (`countedMinor`). Kept by its balance: the latest balance
 * noted up to that day (`noted`, oldest first), or the opening balance before the first.
 */
export function balanceAt(
  account: { readonly mode: AccountMode; readonly openingBalanceMinor: number },
  countedMinor: number,
  noted: ReadonlyArray<DayBalance>,
  day: string,
): number {
  if (account.mode === "lines") {
    return account.openingBalanceMinor + countedMinor;
  }

  return latestBy(noted, day)?.minor ?? account.openingBalanceMinor;
}

/**
 * The balance after each line, for lines given newest first (booked on, then id): `before` is the
 * balance before the oldest of them. The newest line's balance is that balance plus every line.
 */
export function balancesAfter(
  newestFirst: ReadonlyArray<{ readonly amountMinor: number }>,
  before: number,
): ReadonlyArray<number> {
  const after = Array.from({ length: newestFirst.length }, () => 0);
  let balance = before;

  for (let index = newestFirst.length - 1; index >= 0; index -= 1) {
    balance += newestFirst[index]?.amountMinor ?? 0;
    after[index] = balance;
  }

  return after;
}

/**
 * The balance at the end of every day from `from` to `to`, both included, with no gap: a day
 * without a line keeps the day before's balance, so a chart draws steps.
 *
 * - Kept by its lines: `before` is the balance at the end of the day before `from`, and `moves`
 *   the sum of the counted lines of each day that has some.
 * - Kept by its balance: each day is the latest balance noted up to it (`noted`, oldest first),
 *   or the opening balance before the first.
 */
export function dailyBalances(
  account: { readonly mode: AccountMode; readonly openingBalanceMinor: number },
  range: { readonly from: string; readonly to: string },
  before: number,
  moves: ReadonlyArray<DayBalance>,
  noted: ReadonlyArray<DayBalance>,
): ReadonlyArray<DayBalance> {
  const days = Math.max(daysFrom(range.from, range.to), 0);

  if (account.mode === "balance") {
    return Array.from({ length: days }, (_, index) => {
      const day = addDays(range.from, index);

      return { day, minor: balanceAt(account, 0, noted, day) };
    });
  }

  const moveOn = new Map<string, number>();

  for (const move of moves) {
    moveOn.set(move.day, (moveOn.get(move.day) ?? 0) + move.minor);
  }

  const balances: Array<DayBalance> = [];
  let balance = before;

  for (let index = 0; index < days; index += 1) {
    const day = addDays(range.from, index);

    balance += moveOn.get(day) ?? 0;
    balances.push({ day, minor: balance });
  }

  return balances;
}

/** One total per currency, never converted (docs/data-model.md, "Open choices"), by code. */
export function totalsByCurrency(amounts: ReadonlyArray<Money>): ReadonlyArray<Money> {
  const totals = new Map<string, number>();

  for (const amount of amounts) {
    totals.set(amount.currency, (totals.get(amount.currency) ?? 0) + amount.minor);
  }

  return [...totals]
    .map(([currency, minor]) => ({ minor, currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** What the grouping reads of an account. */
type Groupable = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly kind: AccountKind;
  readonly closedOn: string | null;
  readonly balance: Money;
};

export type Grouped<Account> = {
  /** Every group, in the page's order, even an empty one. */
  readonly groups: ReadonlyArray<{
    readonly group: AccountGroup;
    readonly accounts: ReadonlyArray<Account>;
    readonly totals: ReadonlyArray<Money>;
  }>;
  /** The closed accounts, apart and out of every total. */
  readonly closed: ReadonlyArray<Account>;
};

const byName = (a: Groupable, b: Groupable) =>
  a.name.localeCompare(b.name) ||
  (a.institution ?? "").localeCompare(b.institution ?? "") ||
  a.id.localeCompare(b.id);

/**
 * The open accounts in their groups (docs/data-model.md, "Accounts"), by name within each, and
 * each group's totals per currency; the closed accounts apart, out of the totals.
 */
export function groupAccounts<Account extends Groupable>(
  accounts: ReadonlyArray<Account>,
): Grouped<Account> {
  const sorted = [...accounts].sort(byName);
  const open = sorted.filter((account) => account.closedOn === null);

  return {
    groups: ACCOUNT_GROUPS.map((group) => {
      const members = open.filter((account) => groupOf(account.kind) === group);

      return {
        group,
        accounts: members,
        totals: totalsByCurrency(members.map((account) => account.balance)),
      };
    }),
    closed: sorted.filter((account) => account.closedOn !== null),
  };
}

/**
 * Whether a statement balance looks empty: some banks write 0.00 although the account is not
 * empty. A balance of exactly zero while the app's balance at the end of that same day is not zero
 * is taken as not given (docs/data-model.md, "account_balance"); any other balance is kept, a
 * true zero included.
 */
export function looksEmpty(statementMinor: number, appMinor: number): boolean {
  return statementMinor === 0 && appMinor !== 0;
}

/** The account's balance against its statement's, at the end of the statement's day. */
export type BalanceCheck = {
  readonly day: string;
  readonly statementMinor: number;
  readonly appMinor: number;
  /** What the app counts beyond the statement: negative when it counts less. */
  readonly differenceMinor: number;
  readonly agrees: boolean;
};

/**
 * A statement balance against the balance the app computes at the end of that same day
 * (docs/data-model.md, "account_balance"): the account page's check runs it on the latest
 * statement balance, and on each earlier one too, to show a past mismatch. Null without a
 * statement balance.
 */
export function balanceCheck(
  statement: DayBalance,
  appMinorOn: (day: string) => number,
): BalanceCheck;
export function balanceCheck(statement: null, appMinorOn: (day: string) => number): null;
export function balanceCheck(
  statement: DayBalance | null,
  appMinorOn: (day: string) => number,
): BalanceCheck | null {
  if (statement === null) {
    return null;
  }

  const appMinor = appMinorOn(statement.day);
  const differenceMinor = appMinor - statement.minor;

  return {
    day: statement.day,
    statementMinor: statement.minor,
    appMinor,
    differenceMinor,
    agrees: differenceMinor === 0,
  };
}
