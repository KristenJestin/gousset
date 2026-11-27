import { Schema } from "effect";

/** No rule of the user's has this id. */
export class RuleNotFound extends Schema.TaggedError<RuleNotFound>()("RuleNotFound", {
  ruleId: Schema.String,
}) {}

/**
 * A rule's conditions were refused: none, more than `MAX_CONDITIONS`, or one (`index`, from 0)
 * that cannot be read (a value of the wrong kind, a range that goes downwards, an account or a
 * merchant the user does not have).
 */
export class RuleConditionsRefused extends Schema.TaggedError<RuleConditionsRefused>()(
  "RuleConditionsRefused",
  {
    reason: Schema.Literals([
      "empty",
      "too_many",
      "invalid",
      "unknown_account",
      "unknown_merchant",
    ]),
    index: Schema.NullOr(Schema.Number),
  },
) {}

/**
 * What a rule sets was refused: nothing at all, a category that is archived (it classifies nothing
 * new), a merchant that is a payment intermediary (#30: never who was paid), or a subject that is
 * archived (it gets no expense).
 */
export class RuleEffectRefused extends Schema.TaggedError<RuleEffectRefused>()(
  "RuleEffectRefused",
  {
    reason: Schema.Literals([
      "nothing_set",
      "category_archived",
      "merchant_intermediary",
      "subject_archived",
    ]),
  },
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
