import { Schema } from "effect";

/** No line of the user's has this id. */
export class LineNotFound extends Schema.TaggedError<LineNotFound>()("LineNotFound", {
  lineId: Schema.String,
}) {}

/** A month too far from today to be read: more than ten years before or after it. */
export class MonthOutOfRange extends Schema.TaggedError<MonthOutOfRange>()("MonthOutOfRange", {
  month: Schema.String,
  earliest: Schema.String,
  latest: Schema.String,
}) {}

/** The line was already reviewed: in another tab, by a rule, or by the MCP door. */
export class LineAlreadyReviewed extends Schema.TaggedError<LineAlreadyReviewed>()(
  "LineAlreadyReviewed",
  { lineId: Schema.String },
) {}
