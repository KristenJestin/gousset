import { Schema } from "effect";

// Every error names the file's line (counted from 1) and what is wrong there, in fields the import
// screen can translate; `problem` and `expected` are English sentences for the user and agents.
// They, and `text`, carry the file's content (amounts, labels, currency symbols): they never go in
// a log, a trace or a metric, which record an error by its tag alone, with `line`, `column`,
// `field`, `format` or `option` at most (docs/architecture.md, "Telemetry").

/**
 * A CSV file's column, counted from 1, when the error is in one; the other formats have none.
 * The key is absent rather than undefined, so that the other formats' errors stay as they were.
 */
const column = Schema.optionalKey(Schema.Number);

/**
 * The bytes are not a statement of the format asked for: no `<OFX>` element, no QIF header, no
 * CSV table in which a date and an amount column can be told.
 */
export class NotAStatement extends Schema.TaggedError<NotAStatement>()("NotAStatement", {
  format: Schema.Literals(["ofx", "qif", "csv"]),
}) {}

/**
 * The file breaks its format's structure at `line`: an element closed that was never opened, a
 * file that ends inside the statement (cut short), text outside any element.
 */
export class MalformedFile extends Schema.TaggedError<MalformedFile>()("MalformedFile", {
  line: Schema.Number,
  column,
  problem: Schema.String,
}) {}

/** A field the format requires is missing from the record or element that starts at `line`. */
export class MissingField extends Schema.TaggedError<MissingField>()("MissingField", {
  line: Schema.Number,
  column,
  field: Schema.String,
}) {}

/** The value of `field` at `line` cannot be read: `text` as written, and what was `expected`. */
export class InvalidField extends Schema.TaggedError<InvalidField>()("InvalidField", {
  line: Schema.Number,
  column,
  field: Schema.String,
  text: Schema.String,
  expected: Schema.String,
}) {}

/**
 * The file is well formed but holds what Gousset does not import as it is: an investment
 * statement, several accounts in one file, a line in another currency than the account's, an
 * amount whose direction the file does not say.
 */
export class UnsupportedContent extends Schema.TaggedError<UnsupportedContent>()(
  "UnsupportedContent",
  { line: Schema.Number, column, problem: Schema.String },
) {}

/**
 * The caller's `option` cannot be used, whatever the file holds: `text` as given, and what was
 * `expected`. The one error that names no line.
 */
export class InvalidOption extends Schema.TaggedError<InvalidOption>()("InvalidOption", {
  option: Schema.String,
  text: Schema.String,
  expected: Schema.String,
}) {}

export type ReadError =
  | NotAStatement
  | MalformedFile
  | MissingField
  | InvalidField
  | UnsupportedContent
  | InvalidOption;
