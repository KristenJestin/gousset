// The statement readers: a file's bytes in, one account's statement out, with no database. See
// README.md for what each format gives and the decisions behind it.
export { readOfx } from "./ofx";

export type { AmountSigns, OfxAmountSigns, OfxOptions, OfxStatement } from "./ofx";

export { readQif } from "./qif";

export type { QifDateOrder, QifOptions, QifStatement } from "./qif";

export type { DateOrder } from "./dates";

export { minorDigits } from "./amount";

export type { Balance, Statement, StatementLine } from "./statement";

export {
  InvalidField,
  InvalidOption,
  MalformedFile,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";

export type { ReadError } from "./errors";
