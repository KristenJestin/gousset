// What a reader gives back: the statement as the file states it, nothing guessed; its text values
// are only tidied (trimmed, control characters dropped, README). The import (deduplication,
// merchants, rules) works from this and nothing else.

/** One line of a statement, as the file gives it. */
export type StatementLine = {
  /**
   * The day the bank booked the line, `YYYY-MM-DD`, as the file writes it: a time and a time zone
   * after it are read past, never applied (OFX `DTPOSTED`, QIF `D`).
   */
  bookedOn: string;
  /** The value date, `YYYY-MM-DD`, when the file gives one (OFX `DTAVAIL`); `null` otherwise. */
  valueOn: string | null;
  /**
   * The amount in minor units of the statement's currency (cents for EUR, yen for JPY), an exact
   * integer read from the file's digits, never through a float: negative for money out, positive
   * for money in.
   */
  amountMinor: number;
  /**
   * The raw label, as the bank wrote it: OFX `NAME` (or `PAYEE`'s, or `MEMO` when neither is
   * given), QIF `P`. An empty string when the file gives none.
   */
  label: string;
  /** The memo beside the label (OFX `MEMO`, QIF `M`), when given and not already the label. */
  memo: string | null;
  /**
   * The bank's own id for the line, when given: OFX `FITID`, unique within the account; QIF `N`,
   * the cheque number or the bank's reference, which nothing makes unique.
   */
  bankId: string | null;
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
   * The ISO 4217 code every amount is in: OFX `CURDEF`; for QIF, which names none, the currency
   * the caller gave.
   */
  currency: string;
  /** In the file's order. */
  lines: ReadonlyArray<StatementLine>;
  /** The balance the file gives (OFX `LEDGERBAL`; see the README for QIF); `null` otherwise. */
  balance: Balance | null;
};
