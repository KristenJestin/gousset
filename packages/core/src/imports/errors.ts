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

/** No profile of the user's has this id, or none is shipped under this key (`profile`). */
export class ProfileNotFound extends Schema.TaggedError<ProfileNotFound>()("ProfileNotFound", {
  profile: Schema.String,
}) {}

/**
 * The user's profile (`profile`, its id) is stored with a definition Gousset can no longer read
 * (an older shape, a row changed by hand): it reads no file until it is saved again.
 */
export class ProfileUnreadable extends Schema.TaggedError<ProfileUnreadable>()(
  "ProfileUnreadable",
  { profile: Schema.String },
) {}

/** A profile is saved, renamed or imported without a name. */
export class ProfileNameMissing extends Schema.TaggedError<ProfileNameMissing>()(
  "ProfileNameMissing",
  {},
) {}

/**
 * A profile's name, institution or header, or a profile's file (`field`), is longer than `limit`
 * characters (`MAX_PROFILE_NAME`, `MAX_PROFILE_HEADER`, `MAX_PROFILE_FILE`).
 */
export class ProfileTooLong extends Schema.TaggedError<ProfileTooLong>()("ProfileTooLong", {
  field: Schema.Literals(["name", "institution", "header", "file"]),
  limit: Schema.Number,
}) {}

/** The user keeps `limit` profiles already (`MAX_PROFILES`): one is deleted before another is kept. */
export class TooManyProfiles extends Schema.TaggedError<TooManyProfiles>()("TooManyProfiles", {
  limit: Schema.Number,
}) {}

/**
 * A profile's file cannot be imported: it is no JSON, or no profile Gousset reads. `problem` says
 * what is wrong, in English, quoting the file: for the user, never for a log.
 */
export class InvalidProfileFile extends Schema.TaggedError<InvalidProfileFile>()(
  "InvalidProfileFile",
  { problem: Schema.String },
) {}

/**
 * An import's job failed: `code` says why (a reader's error, `CURRENCY_MISMATCH`, `QUERY_FAILED`),
 * and `retry` whether another attempt may do better.
 */
export class ImportFailed extends Schema.TaggedError<ImportFailed>()("ImportFailed", {
  code: Schema.String,
  retry: Schema.Boolean,
}) {}
