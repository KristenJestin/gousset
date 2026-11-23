import { Effect, Result } from "effect";

import { AccountStore } from "./account-store";
import type { AccountChange, AccountFacts, AccountRecord, NewAccount } from "./account-store";
import {
  DEFAULT_CHART_DAYS,
  DEFAULT_LINES,
  MAX_CHART_DAYS,
  MAX_LINES,
  choiceOf,
  groupOf,
  storedAs,
} from "./account-values";
import type {
  AccountChoice,
  AccountEnvelope,
  AccountGroup,
  AccountInput,
  AccountKind,
  AccountMode,
} from "./account-values";
import {
  addDays,
  balanceAt,
  balanceCheck,
  balancesAfter,
  dailyBalances,
  daysFrom,
  groupAccounts,
} from "./balances";
import type { DayBalance } from "./balances";
import {
  AccountAlreadyClosed,
  AccountKeptByLines,
  AccountNameAmbiguous,
  AccountNameUnknown,
  AccountNotClosed,
  AccountNotFound,
  CurrencyLocked,
  DayRangeRefused,
  SettlementRefused,
} from "./errors";
import type { Money } from "./month";
import { today } from "./today";

// The accounts, read for the web app's server functions and the MCP door alike: every figure is
// computed here, on read, from what the store gives (docs/data-model.md, "Open choices").

/** How far an account's statements go: an import's last day, or a statement balance's day. */
export type StatementsUntil = {
  readonly day: string;
  readonly from: "import" | "statement_balance";
};

/** An account as the accounts page lists it. */
export type AccountSummary = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  readonly choice: AccountChoice;
  readonly kind: AccountKind;
  readonly group: AccountGroup;
  readonly currency: string;
  readonly mode: AccountMode;
  /** The balance at the end of today. */
  readonly balance: Money;
  readonly statementsUntil: StatementsUntil | null;
  readonly closedOn: string | null;
};

export type AccountGroupList = {
  readonly group: AccountGroup;
  readonly accounts: ReadonlyArray<AccountSummary>;
  /** One total per currency, never converted. */
  readonly totals: ReadonlyArray<Money>;
};

/** The accounts page: the four groups in order, then the closed accounts, out of the totals. */
export type AccountList = {
  /** Today, the day the balances are given for. */
  readonly day: string;
  readonly groups: ReadonlyArray<AccountGroupList>;
  readonly closed: ReadonlyArray<AccountSummary>;
};

/** A counted line of the account, with the balance after it (lines mode only). */
export type AccountLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly label: string;
  readonly memo: string | null;
  readonly counterpartyName: string | null;
  readonly amount: Money;
  /** Null for an account kept by its balance, whose noted balances are what it holds. */
  readonly balanceAfter: Money | null;
};

/** The account's balance against its latest statement balance, at the end of that day. */
export type StatementCheck = {
  readonly day: string;
  readonly statement: Money;
  readonly app: Money;
  /** What the app counts beyond the statement: negative when it counts less. */
  readonly difference: Money;
  readonly agrees: boolean;
};

/** An account's page. */
export type AccountDetail = {
  readonly account: AccountSummary & {
    readonly envelope: AccountEnvelope | null;
    readonly openingBalance: Money;
    readonly openedOn: string | null;
    /** A card's current account. */
    readonly settlesInto: { readonly id: string; readonly name: string } | null;
  };
  readonly day: string;
  readonly balance: Money;
  /** The current month's counted money in, from the 1st to `day`. */
  readonly monthIn: Money;
  /** The current month's counted money out, from the 1st to `day`, as a positive amount. */
  readonly monthOut: Money;
  /** Counted lines, newest first. */
  readonly lines: ReadonlyArray<AccountLine>;
  /** Older lines remain: read them with `before` set to this line's id. */
  readonly olderBefore: string | null;
  /** The balance at the end of each day of the range, with no gap, in the account's currency. */
  readonly daily: {
    readonly from: string;
    readonly to: string;
    readonly balances: ReadonlyArray<DayBalance>;
  };
  /** Null when no statement gave a balance. */
  readonly check: StatementCheck | null;
};

/** What an account's page reads beyond its settings. */
export type AccountView = {
  /** Read lines older than this line (the id a page gave in `olderBefore`). */
  readonly before?: string;
  /** How many lines, newest first: 50 by default, 200 at most. */
  readonly limit?: number;
  /** The chart's days, both included: the last 90 days to today by default, 366 at most. */
  readonly from?: string;
  readonly to?: string;
};

const money = (minor: number, currency: string): Money => ({ minor, currency });

function statementsUntil(facts: AccountFacts): StatementsUntil | null {
  if (facts.importedTo !== null) {
    return { day: facts.importedTo, from: "import" };
  }

  return facts.statement === null ? null : { day: facts.statement.day, from: "statement_balance" };
}

function summaryOf(facts: AccountFacts, day: string): AccountSummary {
  const { account } = facts;

  return {
    id: account.id,
    name: account.name,
    institution: account.institution,
    choice: choiceOf(account.kind, account.envelope),
    kind: account.kind,
    group: groupOf(account.kind),
    currency: account.currency,
    mode: account.mode,
    balance: money(balanceAt(account, facts.countedMinor, facts.noted, day), account.currency),
    statementsUntil: statementsUntil(facts),
    closedOn: account.closedOn,
  };
}

const readFacts = (owner: string) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;
    const day = yield* today;

    return { day, facts: yield* store.facts(owner, day) };
  });

/** The user's accounts in their groups, with their balances today and each group's totals. */
export const listAccounts = (owner: string) =>
  Effect.map(readFacts(owner), ({ day, facts }): AccountList => {
    const { groups, closed } = groupAccounts(facts.map((each) => summaryOf(each, day)));

    return { day, groups, closed };
  });

function checkOf(facts: AccountFacts): StatementCheck | null {
  const { account } = facts;

  const check = balanceCheck(facts.statement, (day) =>
    balanceAt(account, facts.countedAtStatementMinor, facts.noted, day),
  );

  return check === null
    ? null
    : {
        day: check.day,
        statement: money(check.statementMinor, account.currency),
        app: money(check.appMinor, account.currency),
        difference: money(check.differenceMinor, account.currency),
        agrees: check.agrees,
      };
}

function chartRange(day: string, view: AccountView) {
  const to = view.to ?? day;
  const from = view.from ?? addDays(to, 1 - DEFAULT_CHART_DAYS);
  const days = daysFrom(from, to);

  if (days < 1 || days > MAX_CHART_DAYS) {
    return Result.fail(new DayRangeRefused({ from, to, maxDays: MAX_CHART_DAYS }));
  }

  return Result.succeed({ from, to });
}

/**
 * An account's page: its settings, its balance today, its counted lines newest first with the
 * balance after each, its balance at the end of each day of a range, and the check against its
 * latest statement balance. Fails with `AccountNotFound` or `DayRangeRefused`.
 */
export const showAccount = (owner: string, accountId: string, view: AccountView = {}) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;
    const { day, facts } = yield* readFacts(owner);
    const found = facts.find((each) => each.account.id === accountId);

    if (found === undefined) {
      return yield* new AccountNotFound({ accountId });
    }

    const range = yield* Effect.fromResult(chartRange(day, view));
    const limit = Math.min(Math.max(Math.trunc(view.limit ?? DEFAULT_LINES), 1), MAX_LINES);
    const page = yield* store.lines(owner, accountId, { before: view.before, limit });
    const moves = yield* store.moves(owner, accountId, range);
    const monthFrom = `${day.slice(0, 7)}-01`;
    const monthInOut = yield* store.inOut(owner, accountId, { from: monthFrom, to: day });
    const { account } = found;
    const byLines = account.mode === "lines";
    const after = balancesAfter(page.lines, account.openingBalanceMinor + page.olderMinor);
    const settlesInto = facts.find((each) => each.account.id === account.settlesIntoAccountId);
    const last = page.lines.at(-1);

    const detail: AccountDetail = {
      account: {
        ...summaryOf(found, day),
        envelope: account.envelope,
        openingBalance: money(account.openingBalanceMinor, account.currency),
        openedOn: account.openedOn,
        settlesInto:
          settlesInto === undefined
            ? null
            : { id: settlesInto.account.id, name: settlesInto.account.name },
      },
      day,
      balance: money(balanceAt(account, found.countedMinor, found.noted, day), account.currency),
      monthIn: money(monthInOut.inMinor, account.currency),
      monthOut: money(monthInOut.outMinor, account.currency),
      lines: page.lines.map((line, index) => ({
        id: line.id,
        bookedOn: line.bookedOn,
        valueOn: line.valueOn,
        label: line.label,
        memo: line.memo,
        counterpartyName: line.counterpartyName,
        amount: money(line.amountMinor, account.currency),
        balanceAfter: byLines ? money(after[index] ?? 0, account.currency) : null,
      })),
      olderBefore: page.more && last !== undefined ? last.id : null,
      daily: {
        ...range,
        balances: dailyBalances(
          account,
          range,
          account.openingBalanceMinor + moves.beforeMinor,
          moves.moves,
          found.noted,
        ),
      },
      check: checkOf(found),
    };

    return detail;
  });

const sameText = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;

/**
 * The account a person names, open or closed: by its name, and its institution when two share
 * the name (docs/data-model.md, "Open choices": names are not unique), both ignoring case. Fails
 * with `AccountNameUnknown` (with every account's name) or `AccountNameAmbiguous` (with the
 * accounts of that name).
 */
export const accountNamed = (owner: string, name: string, institution?: string) =>
  Effect.gen(function* () {
    const { facts } = yield* readFacts(owner);
    const accounts = facts.map((each) => each.account);
    const named = accounts.filter((account) => sameText(account.name, name));

    const matches =
      institution === undefined
        ? named
        : named.filter(
            (account) => account.institution !== null && sameText(account.institution, institution),
          );

    const [only, ...others] = matches;

    if (only === undefined) {
      return yield* new AccountNameUnknown({
        name,
        accounts: accounts.map((account) => ({
          name: account.name,
          institution: account.institution,
        })),
      });
    }

    if (others.length > 0) {
      return yield* new AccountNameAmbiguous({
        name,
        matches: matches.map((account) => ({
          name: account.name,
          institution: account.institution,
        })),
      });
    }

    return only;
  });

/**
 * A card's current account, checked against the user's accounts: a card needs one of their open
 * current accounts, and nothing else has one. Not itself.
 */
function settlement(
  input: AccountInput,
  accounts: ReadonlyArray<AccountRecord>,
  self: string | undefined,
): Result.Result<string | null, SettlementRefused> {
  const wanted = input.settlesIntoAccountId;

  if (input.choice !== "card") {
    return wanted === undefined
      ? Result.succeed(null)
      : Result.fail(new SettlementRefused({ reason: "only_a_card" }));
  }

  if (wanted === undefined) {
    return Result.fail(new SettlementRefused({ reason: "required" }));
  }

  const target = accounts.find((account) => account.id === wanted);

  if (
    target === undefined ||
    target.id === self ||
    target.kind !== "current" ||
    target.closedOn !== null
  ) {
    return Result.fail(new SettlementRefused({ reason: "not_open_current" }));
  }

  return Result.succeed(target.id);
}

/** The settings an input sets, the choice stored as its kind and envelope. */
function settingsOf(input: AccountInput, settlesIntoAccountId: string | null) {
  const { kind, envelope } = storedAs(input.choice);

  return {
    name: input.name,
    kind,
    envelope,
    institution:
      input.institution === undefined || input.institution === "" ? null : input.institution,
    currency: input.currency,
    mode: input.mode,
    openingBalanceMinor: input.openingBalanceMinor,
    openedOn: input.openedOn ?? null,
    settlesIntoAccountId,
  };
}

/**
 * Creates an account. Fails with `SettlementRefused` when a card does not name one of the user's
 * open current accounts, or another kind names one.
 */
export const createAccount = (owner: string, input: AccountInput) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.create(owner, (accounts) =>
      Result.map(settlement(input, accounts, undefined), (settlesInto): NewAccount => ({
        ...settingsOf(input, settlesInto),
        closedOn: null,
      })),
    );
  });

/**
 * Changes an account's settings, all at once, as the edit form sends them. Fails with
 * `AccountNotFound`, `CurrencyLocked` (a new currency once the account has a line or a balance)
 * or `SettlementRefused`.
 */
export const editAccount = (owner: string, accountId: string, input: AccountInput) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.update(
      owner,
      accountId,
      ({
        account,
        accounts,
        hasEntries,
      }): Result.Result<AccountChange, CurrencyLocked | SettlementRefused> => {
        if (hasEntries && input.currency !== account.currency) {
          return Result.fail(new CurrencyLocked({ accountId }));
        }

        return Result.map(settlement(input, accounts, accountId), (settlesInto): AccountChange =>
          settingsOf(input, settlesInto),
        );
      },
    );
  });

/**
 * Closes an account on a day: it keeps its lines and leaves the totals. Fails with
 * `AccountNotFound` or `AccountAlreadyClosed`.
 */
export const closeAccount = (owner: string, accountId: string, closedOn: string) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.update(owner, accountId, ({ account }) =>
      account.closedOn === null
        ? Result.succeed({ closedOn })
        : Result.fail(new AccountAlreadyClosed({ accountId, closedOn: account.closedOn })),
    );
  });

/** Reopens a closed account. Fails with `AccountNotFound` or `AccountNotClosed`. */
export const reopenAccount = (owner: string, accountId: string) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.update(owner, accountId, ({ account }) =>
      account.closedOn === null
        ? Result.fail(new AccountNotClosed({ accountId }))
        : Result.succeed({ closedOn: null }),
    );
  });

/**
 * Notes the balance at the end of a day on an account kept by its balance. Fails with
 * `AccountNotFound`, `AccountKeptByLines` or `BalanceAlreadyNoted` (one a day).
 */
export const noteBalance = (owner: string, accountId: string, day: string, balanceMinor: number) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.noteBalance(owner, accountId, (account) =>
      account.mode === "balance"
        ? Result.succeed({ day, minor: balanceMinor })
        : Result.fail(new AccountKeptByLines({ accountId })),
    );
  });
