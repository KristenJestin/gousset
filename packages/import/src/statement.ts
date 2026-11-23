// What a reader gives back: the statement as the file states it, nothing guessed; its text values
// are only tidied (trimmed, control characters dropped, README). The import (deduplication,
// merchants, rules) works from this and nothing else.

/**
 * Who paid the account holder or was paid by them, as the file names them. At least one of the two
 * is given.
 */
export type Counterparty = {
  name: string | null;
  /** Upper case without spaces (`FR7699999000010001234567809`); `null` unless shaped as an IBAN. */
  iban: string | null;
};

/** One line of a statement, as the file gives it. */
export type StatementLine = {
  /**
   * The day the bank booked the line, `YYYY-MM-DD`, as the file writes it: a time and a time zone
   * after it are read past, never applied (OFX `DTPOSTED`, QIF `D`, CAMT.053 `BookgDt`, MT940's
   * entry date).
   */
  bookedOn: string;
  /**
   * The value date, `YYYY-MM-DD`, when the file gives one (OFX `DTAVAIL`, CAMT.053 `ValDt`, MT940's
   * value date); `null` otherwise.
   */
  valueOn: string | null;
  /**
   * The amount in minor units of the statement's currency (cents for EUR, yen for JPY), an exact
   * integer read from the file's digits, never through a float: negative for money out, positive
   * for money in.
   */
  amountMinor: number;
  /**
   * The raw label, as the bank wrote it: OFX `NAME` (or `PAYEE`'s, or `MEMO` when neither is
   * given), QIF `P`; for CAMT.053 and MT940, see the README. An empty string when the file gives
   * none.
   */
  label: string;
  /** The text beside the label (OFX `MEMO`, QIF `M`; README), when given and not already the label. */
  memo: string | null;
  /**
   * The bank's own id for the line, when given: OFX `FITID` and CAMT.053 `AcctSvcrRef`, unique
   * within the account; QIF `N` and MT940's references, which nothing makes unique.
   */
  bankId: string | null;
  /** Who paid or was paid, when the file names them (CAMT.053, MT940); `null` otherwise. */
  counterparty: Counterparty | null;
};

/** The account's balance at the end of the day `on`, every line booked that day included. */
export type Balance = {
  amountMinor: number;
  /** `YYYY-MM-DD`. */
  on: string;
};

/** One account's statement, read from one file. */
export type Statement = {
  /**
   * The ISO 4217 code every amount is in: OFX `CURDEF`, CAMT.053 `Acct/Ccy` (or its amounts'
   * `Ccy`), MT940's balances; for QIF, which names none, the currency the caller gave.
   */
  currency: string;
  /** In the file's order. */
  lines: ReadonlyArray<StatementLine>;
  /**
   * The balance before the statement's first line, at the end of the day `on`, as the file gives it
   * (CAMT.053, MT940); `null` otherwise. Each format's date is read into that day its own way
   * (README): CAMT.053's `OPBD` is the start of its day, so `on` is the day before.
   */
  openingBalance: Balance | null;
  /**
   * The closing balance the file gives (OFX `LEDGERBAL`, CAMT.053 `CLBD`, MT940 `:62F:`; see the
   * README for QIF); `null` otherwise.
   */
  balance: Balance | null;
};
