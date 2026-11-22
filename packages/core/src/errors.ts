import { Schema } from "effect";

/** No line of the user's has this id. */
export class LineNotFound extends Schema.TaggedError<LineNotFound>()("LineNotFound", {
  lineId: Schema.String,
}) {}

/** The line was already reviewed: in another tab, by a rule, or by the MCP door. */
export class LineAlreadyReviewed extends Schema.TaggedError<LineAlreadyReviewed>()(
  "LineAlreadyReviewed",
  { lineId: Schema.String },
) {}
