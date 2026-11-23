import type { QueryFailed } from "@gousset/db/user-data";
import { Context } from "effect";
import type { Effect, Result } from "effect";

import type { AccountEnvelope, AccountKind, AccountMode } from "./account-values";
import type { DayBalance } from "./balances";
import type { AccountNotFound, BalanceAlreadyNoted } from "./errors";

/** An account's row, as the logic reads it. */
export type AccountRecord = {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly envelope: AccountEnvelope | null;
  readonly institution: string | null;
  readonly currency: string;
  readonly mode: AccountMode;
  readonly openingBalanceMinor: number;
  readonly openedOn: string | null;
  readonly closedOn: string | null;
  readonly settlesIntoAccountId: string | null;
};

/** What a write sets on an account; the rest stays. */
export type AccountChange = Partial<Omit<AccountRecord, "id">>;

/** A new account: every setting but its id, made by the database. */
export type NewAccount = Omit<AccountRecord, "id">;

/** What the balances of one account are computed from, as of a day (`facts`). */
export type AccountFacts = {
  readonly account: AccountRecord;
  /** The sum of the counted lines booked on or before the day. */
  readonly countedMinor: number;
  /** The noted balances on or before the day, oldest first. */
  readonly noted: ReadonlyArray<DayBalance>;
  /** The latest statement balance on or before the day: of two on that day, the latest import's. */
  readonly statement: DayBalance | null;
  /** The sum of the counted lines booked on or before the statement balance's day. */
  readonly countedAtStatementMinor: number;
  /** The latest `period_to` of the account's done imports. */
  readonly importedTo: string | null;
};

/** One counted line of an account. */
export type StoredLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly amountMinor: number;
  readonly label: string;
  readonly memo: string | null;
  readonly counterpartyName: string | null;
};

/** Counted lines of an account, newest first (booked on, then id). */
export type LinePage = {
  readonly lines: ReadonlyArray<StoredLine>;
  /** The sum of the counted lines older than the oldest of the page. */
  readonly olderMinor: number;
  /** Older lines remain beyond the page. */
  readonly more: boolean;
};

/** The counted lines of an account over days, summed by day. */
export type DayMoves = {
  /** The sum of the counted lines booked before the first day. */
  readonly beforeMinor: number;
  /** The sum of each day's counted lines, for the days that have some, oldest first. */
  readonly moves: ReadonlyArray<DayBalance>;
};

/** The counted lines of an account over a range, split by sign. */
export type InOut = {
  /** The sum of the positive counted lines of the range. */
  readonly inMinor: number;
  /** The sum of the negative counted lines of the range, as a positive amount. */
  readonly outMinor: number;
};

/** What an edit is decided from, read in the same transaction as the write. */
export type EditFacts = {
  readonly account: AccountRecord;
  /** Every account of the user's, this one included. */
  readonly accounts: ReadonlyArray<AccountRecord>;
  /** The account has a line or a balance: its currency is fixed. */
  readonly hasEntries: boolean;
};

/**
 * Where the accounts are read and written. The live layer (`DatabaseAccountStore`) goes through
 * `UserData`; tests give an in-memory one (`memoryAccountStore`). It reads and writes, and sums;
 * what a figure means and what a write may do is decided by the logic (`./accounts`, `./balances`),
 * whose `decide` each write calls inside its transaction, on what that transaction read.
 */
export class AccountStore extends Context.Service<
  AccountStore,
  {
    /** Every account of the user's, open and closed, with its facts as of `day`. */
    readonly facts: (
      owner: string,
      day: string,
    ) => Effect.Effect<ReadonlyArray<AccountFacts>, QueryFailed>;
    /**
     * Up to `limit` counted lines of an account, newest first, older than the line `before` when
     * given (a line of another account, or none, gives an empty page).
     */
    readonly lines: (
      owner: string,
      accountId: string,
      page: { readonly before: string | undefined; readonly limit: number },
    ) => Effect.Effect<LinePage, QueryFailed>;
    /** The counted lines of an account from `from` to `to`, both included, summed by day. */
    readonly moves: (
      owner: string,
      accountId: string,
      range: { readonly from: string; readonly to: string },
    ) => Effect.Effect<DayMoves, QueryFailed>;
    /** The counted lines of an account from `from` to `to`, both included, in and out apart. */
    readonly inOut: (
      owner: string,
      accountId: string,
      range: { readonly from: string; readonly to: string },
    ) => Effect.Effect<InOut, QueryFailed>;
    /** Creates the account `decide` makes from the user's accounts, in one transaction. */
    readonly create: <E>(
      owner: string,
      decide: (accounts: ReadonlyArray<AccountRecord>) => Result.Result<NewAccount, E>,
    ) => Effect.Effect<AccountRecord, E | QueryFailed>;
    /** Changes an account as `decide` says from what it read, in one transaction. */
    readonly update: <E>(
      owner: string,
      accountId: string,
      decide: (facts: EditFacts) => Result.Result<AccountChange, E>,
    ) => Effect.Effect<AccountRecord, E | AccountNotFound | QueryFailed>;
    /** Notes the balance `decide` gives for the account, in one transaction: one a day. */
    readonly noteBalance: <E>(
      owner: string,
      accountId: string,
      decide: (account: AccountRecord) => Result.Result<DayBalance, E>,
    ) => Effect.Effect<DayBalance, E | AccountNotFound | BalanceAlreadyNoted | QueryFailed>;
  }
>()("@gousset/core/AccountStore") {}
