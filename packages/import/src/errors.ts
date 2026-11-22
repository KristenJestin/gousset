import { Schema } from "effect";

// Every error names the file's line (counted from 1) and what is wrong there, in fields the import
// screen can translate; `problem` and `expected` are English sentences for logs and agents.

/** The bytes are not a statement of the format asked for: no `<OFX>` element, no QIF header. */
export class NotAStatement extends Schema.TaggedError<NotAStatement>()("NotAStatement", {
  format: Schema.Literals(["ofx", "qif"]),
}) {}

/**
 * The file breaks its format's structure at `line`: an element closed that was never opened, a
 * file that ends inside the statement (cut short), text outside any element.
 */
export class MalformedFile extends Schema.TaggedError<MalformedFile>()("MalformedFile", {
  line: Schema.Number,
  problem: Schema.String,
}) {}

/** A field the format requires is missing from the record or element that starts at `line`. */
export class MissingField extends Schema.TaggedError<MissingField>()("MissingField", {
  line: Schema.Number,
  field: Schema.String,
}) {}

/** The value of `field` at `line` cannot be read: `text` as written, and what was `expected`. */
export class InvalidField extends Schema.TaggedError<InvalidField>()("InvalidField", {
  line: Schema.Number,
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
  { line: Schema.Number, problem: Schema.String },
) {}

export type ReadError =
  | NotAStatement
  | MalformedFile
  | MissingField
  | InvalidField
  | UnsupportedContent;
