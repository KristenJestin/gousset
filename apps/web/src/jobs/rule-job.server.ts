import { RuleJobInput, applyRuleToPast } from "@gousset/core";
import { Effect } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";

/** Applying a rule's one step. */
export const APPLY_RULE_STEPS = ["apply"] as const;

/**
 * Applying a rule to the lines already there (#25): every line it applies to gets what it sets, in
 * one transaction, so that an attempt run again changes nothing more. The step's count is how many
 * lines it changed, which its page and the MCP door say, and which the job keeps once it is over.
 * A rule deleted meanwhile is not worth another attempt.
 */
export const ruleJob = defineJob({
  name: "apply-rule",
  input: RuleJobInput,
  steps: APPLY_RULE_STEPS,
  retries: { limit: 2, delaySeconds: 5, backoff: true },
  timeoutSeconds: 600,
  run: (input, owner) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      yield* progress.step("apply");

      const applied = yield* applyRuleToPast(owner, input.ruleId, input.includeByHand).pipe(
        Effect.provide(userData),
        Effect.catchTags({
          RuleNotFound: () => Effect.fail(new JobFailed({ code: "RULE_NOT_FOUND", retry: false })),
          QueryFailed: (failed) =>
            Effect.fail(new JobFailed({ code: `QUERY_FAILED_${failed.code}`, retry: true })),
        }),
      );

      yield* progress.step("apply", { done: applied.changed });

      // Its lines may be of any month.
      return { everyMonth: true as const };
    }),
});
