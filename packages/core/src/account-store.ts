import type { QueryFailed } from "@gousset/db/user-data";
import { Context } from "effect";
import type { Effect, Result } from "effect";

import type { AccountEnvelope, AccountKind, AccountMode, CreditOrder } from "./account-values";
import type { DayBalance } from "./balances";
import type { CountedLine } from "./credits";
import type { AccountNotFound, BalanceAlreadyNoted, LineNotFound } from "./errors";
import type { SubjectName } from "./subjects/counting";

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
  /** Read for a benefit account only: in which order its credits are used. */
  readonly creditOrder: CreditOrder;
  /** Read for an account kept by its balance only: the category its movement goes to (#31). */
  readonly balanceCategoryId: string | null;
  /**
   * Read for a benefit account only (#28): how many days after the card's own line its issuer may
   * book the rest of a purchase on a linked bank card, 0 to 7.
   */
  readonly topUpDays: number;
  /** Read for a benefit account only: the most the card pays a day, in minor units; null unknown. */
  readonly topUpCapMinor: number | null;
};

/** A category an account's movement may go to, as a write checks it. */
export type ChoosableCategory = {
  readonly id: string;
  readonly archived: boolean;
};

/** The category an account kept by its balance sends its movement to, as its page names it. */
export type BalanceCategory = {
  readonly id: string;
  /** With its parent's, for a child: "Food > Meals out". */
  readonly name: string;
  readonly kind: "expense" | "income";
  readonly archived: boolean;
};

/** What a write sets on an account; the rest stays. */
export type AccountChange = Partial<Omit<AccountRecord, "id">>;

/** A new account: every setting but its id, made by the database. */
export type NewAccount = Omit<AccountRecord, "id">;

/** A statement balance paired with the sum of counted lines booked on or before its own day. */
export type StatementBalanceAt = DayBalance & {
  /** The sum of the counted lines booked on or before this balance's own day. */
  readonly countedMinor: number;
};

/** What the balances of one account are computed from, as of a day (`facts`). */
export type AccountFacts = {
  readonly account: AccountRecord;
  /** The account's `balanceCategoryId`, read; null when it has none. */
  readonly balanceCategory: BalanceCategory | null;
  /** The sum of the counted lines booked on or before the day. */
  readonly countedMinor: number;
  /** The noted balances on or before the day, oldest first. */
  readonly noted: ReadonlyArray<DayBalance>;
  /**
   * Every statement balance on or before the day, oldest first (of two on one day, the latest
   * import's), each with the counted lines summed up to its own day: the account page's check
   * (docs/data-model.md, "account_balance") compares the latest against the app's balance, and
   * shows the earlier ones that disagree too.
   */
  readonly statements: ReadonlyArray<StatementBalanceAt>;
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
  /** A credit of a benefit account: the day it expires. */
  readonly expiresOn: string | null;
  /** `balance`: the movement a noted balance makes (#31), which has no label of its own. */
  readonly source: "import" | "manual" | "balance" | "counterpart";
  /** Its entries' subjects (#37), each once, by name: none for most lines. */
  readonly subjects: ReadonlyArray<SubjectName>;
};

/** A line of the user's, as a change of its expiry is decided from, with its account. */
export type LineFacts = {
  readonly id: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly state: "counted" | "held" | "discarded";
  readonly expiresOn: string | null;
  readonly account: AccountRecord;
};

/** A line's expiry, as a write left it. */
export type LineExpiry = {
  readonly lineId: string;
  readonly accountId: string;
  readonly expiresOn: string | null;
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
  /** Every category of the user's. */
  readonly categories: ReadonlyArray<ChoosableCategory>;
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
     * Up to `limit` counted lines of an account booked on or before `day`, newest first, older
     * than the line `before` when given (a line of another account, or none, gives an empty page).
     * `day` is today's: a line booked after it is never shown, for the same reason it is never
     * counted in the balance (`facts`).
     */
    readonly lines: (
      owner: string,
      accountId: string,
      page: { readonly before: string | undefined; readonly limit: number; readonly day: string },
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
    /**
     * Every counted line of an account booked on or before `day`, oldest first (booked on, then
     * id): what a benefit account's credits are replayed from.
     */
    readonly countedLines: (
      owner: string,
      accountId: string,
      day: string,
    ) => Effect.Effect<ReadonlyArray<CountedLine>, QueryFailed>;
    /** Creates the account `decide` makes from the user's accounts and categories, at once. */
    readonly create: <E>(
      owner: string,
      decide: (
        accounts: ReadonlyArray<AccountRecord>,
        categories: ReadonlyArray<ChoosableCategory>,
      ) => Result.Result<NewAccount, E>,
    ) => Effect.Effect<AccountRecord, E | QueryFailed>;
    /** Changes an account as `decide` says from what it read, in one transaction. */
    readonly update: <E>(
      owner: string,
      accountId: string,
      decide: (facts: EditFacts) => Result.Result<AccountChange, E>,
    ) => Effect.Effect<AccountRecord, E | AccountNotFound | QueryFailed>;
    /**
     * Notes the balance `decide` gives for the account, in one transaction: one a day. An account
     * kept by its balance gets its movement line in the same transaction (`./balance-lines`); an
     * account's update does too, since its opening balance, mode and category shape them.
     */
    readonly noteBalance: <E>(
      owner: string,
      accountId: string,
      decide: (account: AccountRecord) => Result.Result<DayBalance, E>,
    ) => Effect.Effect<DayBalance, E | AccountNotFound | BalanceAlreadyNoted | QueryFailed>;
    /** Sets the expiry `decide` gives a line from what it read, in one transaction. */
    readonly setLineExpiry: <E>(
      owner: string,
      lineId: string,
      decide: (line: LineFacts) => Result.Result<string | null, E>,
    ) => Effect.Effect<LineExpiry, E | LineNotFound | QueryFailed>;
  }
>()("@gousset/core/AccountStore") {}
