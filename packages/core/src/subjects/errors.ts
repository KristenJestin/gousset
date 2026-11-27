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
 * - `period`: a year that is none from 1900 to 9999;
 * - `payback`: who pays it back empty or over 100 characters once trimmed, a day that is no
 *   `YYYY-MM-DD`, or a day asked or settled without anyone paying it back (#217);
 * - `payback_lines`: the option "paid back" turned off while lines pay it back: detach them first.
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
    "payback",
    "payback_lines",
  ]),
  subjectId: Schema.optional(Schema.String),
  accountId: Schema.optional(Schema.String),
  entryId: Schema.optional(Schema.String),
}) {}

/**
 * Lines that cannot pay back a subject (#217; docs/data-model.md, v0.5, "Paid back"). For a
 * line, `lineId` naming it:
 * - `going_out`: money leaving the account: only money coming in pays back;
 * - `not_counted`: a line held as a near duplicate, or discarded;
 * - `zero_amount`: a line of nothing;
 * - `made_from_balance`: a noted balance's movement (#31);
 * - `split`: a line split across several categories;
 * - `linked`: a line linked with other lines into one entry (#27), a refund among them;
 * - `transfer`: a side of a transfer, a works council's funding (#29) among them;
 * - `currency`: a line of another currency than the user's;
 * - `other_subject`: a line that pays back another subject already (`subjectId`), to detach from
 *   it first.
 *
 * For the subject, `subjectId` naming it: one without the option "paid back" (`not_paid_back`), an
 * archived one (`archived`); and more than 100 lines in one call (`lines`).
 */
export class PaybackRefused extends Schema.TaggedError<PaybackRefused>()("PaybackRefused", {
  reason: Schema.Literals([
    "going_out",
    "not_counted",
    "zero_amount",
    "made_from_balance",
    "split",
    "linked",
    "transfer",
    "currency",
    "other_subject",
    "not_paid_back",
    "archived",
    "lines",
  ]),
  lineId: Schema.optional(Schema.String),
  subjectId: Schema.optional(Schema.String),
}) {}
