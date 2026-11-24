import { Schema } from "effect";

/** No rule of the user's has this id. */
export class RuleNotFound extends Schema.TaggedError<RuleNotFound>()("RuleNotFound", {
  ruleId: Schema.String,
}) {}

/**
 * A rule's conditions were refused: none, more than `MAX_CONDITIONS`, or one (`index`, from 0)
 * that cannot be read (a value of the wrong kind, a range that goes downwards, an account the user
 * does not have).
 */
export class RuleConditionsRefused extends Schema.TaggedError<RuleConditionsRefused>()(
  "RuleConditionsRefused",
  {
    reason: Schema.Literals(["empty", "too_many", "invalid", "unknown_account"]),
    index: Schema.NullOr(Schema.Number),
  },
) {}

/**
 * What a rule sets was refused: nothing at all, a category that is archived (it classifies nothing
 * new), or a merchant that is a payment intermediary (#30: never who was paid).
 */
export class RuleEffectRefused extends Schema.TaggedError<RuleEffectRefused>()(
  "RuleEffectRefused",
  { reason: Schema.Literals(["nothing_set", "category_archived", "merchant_intermediary"]) },
) {}

/** The user has `MAX_RULES` rules already. */
export class TooManyRules extends Schema.TaggedError<TooManyRules>()("TooManyRules", {
  limit: Schema.Number,
}) {}

/** Applying a rule to the past could not be sent: the job queue did not answer. */
export class RuleJobUnavailable extends Schema.TaggedError<RuleJobUnavailable>()(
  "RuleJobUnavailable",
  {},
) {}
