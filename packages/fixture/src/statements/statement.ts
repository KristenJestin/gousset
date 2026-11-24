/** One line of a made-up bank statement. */
export type StatementLine = {
  /** The day the bank booked it, `YYYY-MM-DD`. */
  bookedOn: string;
  /** In minor units (cents): negative for money out, positive for money in. */
  amountMinor: number;
  label: string;
  /** The bank's own reference for the line, unique within the account. */
  reference: string;
};

/** A made-up bank statement: one account over one period, the shape every format is written from. */
export type Statement = {
  bank: { name: string; bic: string; code: string };
  account: { iban: string; number: string; holder: string; currency: string };
  /** `YYYY-MM-DD`, both included. */
  from: string;
  to: string;
  openingBalanceMinor: number;
  lines: ReadonlyArray<StatementLine>;
  /**
   * The closing balance the file states, when it is not the one its lines make: a bank that writes
   * 0.00 although the account is not empty. Left out, the opening balance plus every line.
   */
  statedClosingBalanceMinor?: number;
};

/** The closing balance a file of the statement writes. */
export function closingBalanceMinor(statement: Statement): number {
  if (statement.statedClosingBalanceMinor !== undefined) {
    return statement.statedClosingBalanceMinor;
  }

  let balance = statement.openingBalanceMinor;

  for (const line of statement.lines) {
    balance += line.amountMinor;
  }

  return balance;
}

/** `-1234.5` written as `-1234.50`, with the decimal separator a format asks for. */
export function formatMinor(amountMinor: number, separator: "." | ","): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  const units = Math.trunc(absolute / 100);
  const cents = String(absolute % 100).padStart(2, "0");

  return `${sign}${units}${separator}${cents}`;
}

/** `2026-10-03` as its parts, for formats that write dates their own way. */
export function dayParts(day: string) {
  const [year = "", month = "", date = ""] = day.split("-");

  return { year, month, date };
}
