import { Schema } from "effect";

/** No subject of the user's has this id. */
export class SubjectNotFound extends Schema.TaggedError<SubjectNotFound>()("SubjectNotFound", {
  subjectId: Schema.String,
}) {}

/** A sibling already has this name (any case): the names under one parent are unique. */
export class SubjectNameTaken extends Schema.TaggedError<SubjectNameTaken>()("SubjectNameTaken", {
  name: Schema.String,
}) {}

/**
 * No subject of the user's has this name nor this path ("House > Garden shed"), in any case;
 * `close`, the paths that contain it.
 */
export class SubjectNameUnknown extends Schema.TaggedError<SubjectNameUnknown>()(
  "SubjectNameUnknown",
  { name: Schema.String, close: Schema.Array(Schema.String) },
) {}

/** Several subjects of the user's have this name, under other parents: `matches`, their paths. */
export class SubjectNameAmbiguous extends Schema.TaggedError<SubjectNameAmbiguous>()(
  "SubjectNameAmbiguous",
  { name: Schema.String, matches: Schema.Array(Schema.String) },
) {}

/** No entry of the user's has this id. */
export class EntryNotFound extends Schema.TaggedError<EntryNotFound>()("EntryNotFound", {
  entryId: Schema.String,
}) {}

/**
 * A change of the subjects that their rules refuse (docs/data-model.md, v0.5):
 * - `name`: a name empty or longer than 100 characters once trimmed, or holding `>` ("House >
 *   Garden shed" is how a child is named where a name alone is not enough);
 * - `parent_missing`: a parent that is none of the user's subjects (`subjectId` names it);
 * - `parent_archived`: an archived parent, which can no longer be chosen;
 * - `cycle`: a subject under itself, or under one of its own descendants;
 * - `value`: an estimated value without its currency or a currency without a value, a value that
 *   is no whole number of minor units from 0, or a currency that is no ISO 4217 code;
 * - `loan`: a loan that is none of the user's `loan` accounts (`accountId` names it);
 * - `account`: a linked account that is none of the user's (`accountId` names it);
 * - `dates`: a day that is no `YYYY-MM-DD`, an end before the start, or an end without a start;
 * - `too_many`: the user has 200 subjects already, archived ones included;
 * - `archived`: an expense attached to an archived subject, or taken off one;
 * - `not_an_expense`: an entry that is an income: only expenses have subjects (`entryId` names it);
 * - `entries`: more than 500 expenses in one call;
 * - `period`: a year that is none from 1900 to 9999.
 */
export class SubjectRefused extends Schema.TaggedError<SubjectRefused>()("SubjectRefused", {
  reason: Schema.Literals([
    "name",
    "parent_missing",
    "parent_archived",
    "cycle",
    "value",
    "loan",
    "account",
    "dates",
    "too_many",
    "archived",
    "not_an_expense",
    "entries",
    "period",
  ]),
  subjectId: Schema.optional(Schema.String),
  accountId: Schema.optional(Schema.String),
  entryId: Schema.optional(Schema.String),
}) {}
