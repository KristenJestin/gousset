// The statement readers: a file's bytes in, one account's statement out, with no database. See
// README.md for what each format gives and the decisions behind it.
export { readOfx } from "./ofx";

export type { AmountSigns, OfxAmountSigns, OfxOptions, OfxStatement } from "./ofx";

export { readQif } from "./qif";

export type { QifDateOrder, QifOptions, QifStatement } from "./qif";

export { readCamt053 } from "./camt053";

export { readMt940 } from "./mt940";

export {
  csvFile,
  headerMatches,
  matchCsvHeader,
  normalizeHeader,
  previewCsvRows,
  readCsv,
  readCsvHeader,
  testReadCsv,
} from "./csv";

export type { CsvCandidate, CsvFile, CsvOptions } from "./csv";

export { SHIPPED_PROFILES, shippedProfile } from "./csv-shipped";

export type { ShippedProfile } from "./csv-shipped";

export { detectCsvProfile } from "./csv-detect";

export type { CsvProposal, CsvUnsure } from "./csv-detect";

export { CsvProfile } from "./csv-profile";

export type { CsvLayout } from "./csv-profile";

export type { DateOrder } from "./dates";

export { minorDigits, readAmount } from "./amount";

export type {
  Balance,
  Counterparty,
  OriginalAmount,
  Statement,
  StatementAccount,
  StatementLine,
} from "./statement";

export { detectFormat } from "./format";

export type { StatementFormat } from "./format";

export {
  InvalidField,
  InvalidOption,
  MalformedFile,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";

export type { ReadError } from "./errors";
