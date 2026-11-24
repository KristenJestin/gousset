import { Effect, Result } from "effect";

import { AccountStore } from "./account-store";
import type {
  AccountChange,
  AccountFacts,
  AccountRecord,
  BalanceCategory,
  ChoosableCategory,
  EditFacts,
  NewAccount,
} from "./account-store";
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
  CreditOrder,
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
import { creditsLeft, expiringOf } from "./credits";
import {
  AccountAlreadyClosed,
  AccountKeptByLines,
  AccountNameAmbiguous,
  AccountNameUnknown,
  AccountNotClosed,
  AccountNotFound,
  BalanceCategoryRefused,
  CurrencyLocked,
  DayRangeRefused,
  ExpiryBeforeCredit,
  NotACredit,
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
  /** A credit of a benefit account: the day it expires. */
  readonly expiresOn: string | null;
  /** The movement a noted balance makes (#31): it has no label, the interface names it. */
  readonly fromBalance: boolean;
};

/** A credit of a benefit account with something left on it. */
export type AccountCredit = {
  /** Null for the opening balance, the oldest credit, which is no line. */
  readonly lineId: string | null;
  /** Null for the opening balance. */
  readonly creditedOn: string | null;
  /** Null for the opening balance. */
  readonly label: string | null;
  readonly amount: Money;
  readonly left: Money;
  readonly expiresOn: string | null;
};

/** What is left of a benefit account's credits, computed on read in its order of use. */
export type AccountCredits = {
  readonly order: CreditOrder;
  /** The credits with something left, in order of use: the first is the next one used. */
  readonly open: ReadonlyArray<AccountCredit>;
  /** What is left on the credits with an expiry, summed by expiry day, soonest first. */
  readonly expiring: ReadonlyArray<{ readonly day: string; readonly amount: Money }>;
  /** What the outgoing lines took beyond every credit before them, until a later credit covers it. */
  readonly uncovered: Money;
};

/** The account's balance against one statement balance, at the end of its day. */
export type StatementCheckEntry = {
  readonly day: string;
  readonly statement: Money;
  readonly app: Money;
  /** What the app counts beyond the statement: negative when it counts less. */
  readonly difference: Money;
};

/** The account's balance against its latest statement balance, at the end of that day. */
export type StatementCheck = StatementCheckEntry & {
  readonly agrees: boolean;
  /** Earlier statement balances that disagree with the app's balance at the end of their day. */
  readonly earlierMismatches: ReadonlyArray<StatementCheckEntry>;
};

/** An account's page. */
export type AccountDetail = {
  readonly account: AccountSummary & {
    readonly envelope: AccountEnvelope | null;
    readonly openingBalance: Money;
    readonly openedOn: string | null;
    /** In which order a benefit account's credits are used; read for a benefit account only. */
    readonly creditOrder: CreditOrder;
    /** A card's current account. */
    readonly settlesInto: { readonly id: string; readonly name: string } | null;
    /** Read for an account kept by its balance: the category its movement goes to (#31). */
    readonly balanceCategory: BalanceCategory | null;
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
  /** Null unless the account is a benefit account kept by its lines. */
  readonly credits: AccountCredits | null;
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

  const latest = facts.statements.at(-1);

  return latest === undefined ? null : { day: latest.day, from: "statement_balance" };
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

/** A benefit account's credits as of `day`, replayed from its counted lines up to then. */
const creditsOf = (owner: string, account: AccountRecord, day: string) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;
    const lines = yield* store.countedLines(owner, account.id, day);

    const { credits, uncoveredMinor } = creditsLeft(
      account.openingBalanceMinor,
      lines,
      account.creditOrder,
    );

    const open = credits
      .filter((credit) => credit.leftMinor > 0)
      .map((credit): AccountCredit => ({
        lineId: credit.lineId,
        creditedOn: credit.creditedOn,
        label: credit.label,
        amount: money(credit.amountMinor, account.currency),
        left: money(credit.leftMinor, account.currency),
        expiresOn: credit.expiresOn,
      }));

    const detail: AccountCredits = {
      order: account.creditOrder,
      open,
      expiring: expiringOf(credits).map(({ day: expiresOn, minor }) => ({
        day: expiresOn,
        amount: money(minor, account.currency),
      })),
      uncovered: money(uncoveredMinor, account.currency),
    };

    return detail;
  });

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

function entryOf(
  account: AccountRecord,
  noted: ReadonlyArray<DayBalance>,
  entry: { readonly day: string; readonly minor: number; readonly countedMinor: number },
): StatementCheckEntry & { readonly agrees: boolean } {
  const check = balanceCheck(entry, () => balanceAt(account, entry.countedMinor, noted, entry.day));

  return {
    day: check.day,
    statement: money(check.statementMinor, account.currency),
    app: money(check.appMinor, account.currency),
    difference: money(check.differenceMinor, account.currency),
    agrees: check.agrees,
  };
}

function checkOf(facts: AccountFacts): StatementCheck | null {
  const { account, statements, noted } = facts;
  const latest = statements.at(-1);

  if (latest === undefined) {
    return null;
  }

  const earlierMismatches = statements
    .slice(0, -1)
    .map((entry) => entryOf(account, noted, entry))
    .filter((entry) => !entry.agrees)
    .map(({ day, statement, app, difference }) => ({ day, statement, app, difference }));

  return { ...entryOf(account, noted, latest), earlierMismatches };
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
    const page = yield* store.lines(owner, accountId, { before: view.before, limit, day });
    const moves = yield* store.moves(owner, accountId, range);
    const monthFrom = `${day.slice(0, 7)}-01`;
    const monthInOut = yield* store.inOut(owner, accountId, { from: monthFrom, to: day });
    const { account } = found;
    const byLines = account.mode === "lines";
    const after = balancesAfter(page.lines, account.openingBalanceMinor + page.olderMinor);
    const settlesInto = facts.find((each) => each.account.id === account.settlesIntoAccountId);
    const last = page.lines.at(-1);

    const credits =
      account.kind === "benefit" && byLines ? yield* creditsOf(owner, account, day) : null;

    const detail: AccountDetail = {
      account: {
        ...summaryOf(found, day),
        envelope: account.envelope,
        openingBalance: money(account.openingBalanceMinor, account.currency),
        creditOrder: account.creditOrder,
        openedOn: account.openedOn,
        settlesInto:
          settlesInto === undefined
            ? null
            : { id: settlesInto.account.id, name: settlesInto.account.name },
        balanceCategory: found.balanceCategory,
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
        expiresOn: line.expiresOn,
        fromBalance: line.source === "balance",
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
      credits,
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

/**
 * The category an account kept by its balance sends its movement to: one of the user's, and not an
 * archived one unless the account already has it (an archived category keeps what it has). Left
 * out, the account's current one (none for a new account); `null`, none.
 */
function balanceCategoryOf(
  input: AccountInput,
  categories: ReadonlyArray<ChoosableCategory>,
  current: string | null,
): Result.Result<string | null, BalanceCategoryRefused> {
  const wanted = input.balanceCategoryId;

  if (wanted === undefined) {
    return Result.succeed(current);
  }

  if (wanted === null) {
    return Result.succeed(null);
  }

  const found = categories.find((each) => each.id === wanted);

  if (found === undefined) {
    return Result.fail(new BalanceCategoryRefused({ categoryId: wanted, reason: "unknown" }));
  }

  if (found.archived && wanted !== current) {
    return Result.fail(new BalanceCategoryRefused({ categoryId: wanted, reason: "archived" }));
  }

  return Result.succeed(wanted);
}

/** The settings an input sets, the choice stored as its kind and envelope. */
function settingsOf(
  input: AccountInput,
  settlesIntoAccountId: string | null,
  creditOrder: CreditOrder,
  balanceCategoryId: string | null,
) {
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
    creditOrder: input.creditOrder ?? creditOrder,
    balanceCategoryId,
  };
}

/**
 * Creates an account; a benefit account's credits are used oldest first unless the input says
 * otherwise. Fails with `SettlementRefused` when a card does not name one of the user's
 * open current accounts, or another kind names one, and with `BalanceCategoryRefused` for a
 * category that is none of the user's, or archived.
 */
export const createAccount = (owner: string, input: AccountInput) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.create(owner, (accounts, categories) =>
      decideNew(input, accounts, categories),
    );
  });

function decideNew(
  input: AccountInput,
  accounts: ReadonlyArray<AccountRecord>,
  categories: ReadonlyArray<ChoosableCategory>,
): Result.Result<NewAccount, SettlementRefused | BalanceCategoryRefused> {
  const settlesInto = settlement(input, accounts, undefined);

  if (Result.isFailure(settlesInto)) {
    return Result.fail(settlesInto.failure);
  }

  return Result.map(balanceCategoryOf(input, categories, null), (category) => ({
    ...settingsOf(input, settlesInto.success, "oldest_first", category),
    closedOn: null,
  }));
}

/**
 * Changes an account's settings, all at once, as the edit form sends them; a credit order left
 * out stays as it is. Fails with
 * `AccountNotFound`, `CurrencyLocked` (a new currency once the account has a line or a balance),
 * `SettlementRefused` or `BalanceCategoryRefused`. An account kept by its balance has its movement
 * lines made again in the same transaction: its opening balance, mode and category shape them.
 */
export const editAccount = (owner: string, accountId: string, input: AccountInput) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.update(owner, accountId, (facts) => decideEdit(input, facts));
  });

function decideEdit(
  input: AccountInput,
  facts: EditFacts,
): Result.Result<AccountChange, CurrencyLocked | SettlementRefused | BalanceCategoryRefused> {
  const { account, accounts, hasEntries, categories } = facts;

  if (hasEntries && input.currency !== account.currency) {
    return Result.fail(new CurrencyLocked({ accountId: account.id }));
  }

  const settlesInto = settlement(input, accounts, account.id);

  if (Result.isFailure(settlesInto)) {
    return Result.fail(settlesInto.failure);
  }

  const category = balanceCategoryOf(input, categories, account.balanceCategoryId);

  return Result.map(category, (chosen) =>
    settingsOf(input, settlesInto.success, account.creditOrder, chosen),
  );
}

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
 * Notes the balance at the end of a day on an account kept by its balance: it makes the month's
 * movement, one line, an expense or an income in the account's category (#31), and the movement of
 * the next noted balance changes with it. Fails with `AccountNotFound`, `AccountKeptByLines` or
 * `BalanceAlreadyNoted` (one a day).
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

/**
 * Sets the day a credit of a benefit account expires, or takes it away with `null`. Fails with
 * `LineNotFound` (no line of the user's), `NotACredit` (not a counted positive line of a benefit
 * account) or `ExpiryBeforeCredit` (a day before the one credited). It moves no money: what
 * expires leaves the balance when a line says so (docs/data-model.md, "Accounts").
 */
export const setCreditExpiry = (owner: string, lineId: string, expiresOn: string | null) =>
  Effect.gen(function* () {
    const store = yield* AccountStore;

    return yield* store.setLineExpiry(
      owner,
      lineId,
      (line): Result.Result<string | null, NotACredit | ExpiryBeforeCredit> => {
        if (line.account.kind !== "benefit" || line.state !== "counted" || line.amountMinor <= 0) {
          return Result.fail(new NotACredit({ lineId }));
        }

        if (expiresOn !== null && expiresOn < line.bookedOn) {
          return Result.fail(
            new ExpiryBeforeCredit({ lineId, creditedOn: line.bookedOn, expiresOn }),
          );
        }

        return Result.succeed(expiresOn);
      },
    );
  });
