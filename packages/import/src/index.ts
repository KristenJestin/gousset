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
  recognisesFiles,
  testReadCsv,
} from "./csv";

export type { CsvCandidate, CsvFile, CsvOptions, CsvTable } from "./csv";

export {
  ColumnPlace,
  CsvDefinition,
  OPERATION_KINDS,
  OperationKind,
  OperationsProfile,
  isPlace,
  readsOperations,
} from "./operations-profile";

export { findsColumnsByName, placesIn as operationPlaces } from "./operations-columns";

export type { OperationField, OperationPlaces } from "./operations-columns";

export { readOperations, testReadOperations } from "./operations";

export type { OperationRow, Operations } from "./operations";

export { SHIPPED_PROFILES, shippedProfile } from "./csv-shipped";

export type { ShippedProfile } from "./csv-shipped";

export { detectCsvProfile } from "./csv-detect";

export type { CsvProposal, CsvUnsure } from "./csv-detect";

export { CsvProfile, MAX_DESCRIPTION } from "./csv-profile";

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
