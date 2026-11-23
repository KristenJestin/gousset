import { Schema } from "effect";

// Why an import refuses a call. Each names what the screen and the MCP door need to say what to do,
// and nothing of the file: no label, no amount, no file name.

/** The file is empty. */
export class EmptyFile extends Schema.TaggedError<EmptyFile>()("EmptyFile", {}) {}

/** The file is larger than an import takes (`MAX_FILE_BYTES`). */
export class FileTooLarge extends Schema.TaggedError<FileTooLarge>()("FileTooLarge", {
  bytes: Schema.Number,
  limit: Schema.Number,
}) {}

/** Nothing in the file says which format it is in, and none was named. */
export class UnknownFormat extends Schema.TaggedError<UnknownFormat>()("UnknownFormat", {}) {}

// No account of the user's has this id: the accounts' own error, one class for both.
export { AccountNotFound } from "../errors";

/** No import of the user's has this id. */
export class ImportNotFound extends Schema.TaggedError<ImportNotFound>()("ImportNotFound", {
  importId: Schema.String,
}) {}

/**
 * The import cannot do what was asked in its state: undo one that is still running, answer one
 * that waits for nothing, run again one that is done.
 */
export class ImportBusy extends Schema.TaggedError<ImportBusy>()("ImportBusy", {
  importId: Schema.String,
  status: Schema.String,
}) {}

/** The job queue did not take the import: the database did not answer. Try again later. */
export class ImportUnavailable extends Schema.TaggedError<ImportUnavailable>()(
  "ImportUnavailable",
  {},
) {}

/**
 * An import's job failed: `code` says why (a reader's error, `CURRENCY_MISMATCH`, `QUERY_FAILED`),
 * and `retry` whether another attempt may do better.
 */
export class ImportFailed extends Schema.TaggedError<ImportFailed>()("ImportFailed", {
  code: Schema.String,
  retry: Schema.Boolean,
}) {}
