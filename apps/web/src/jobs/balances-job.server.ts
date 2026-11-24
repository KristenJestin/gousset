import { remakeEveryBalanceLine } from "@gousset/core";
import { Effect, Schema } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";

/** The remake's one step. */
export const BALANCE_LINES_STEPS = ["remake"] as const;

/**
 * The movement lines of a user's accounts kept by their balance (#31): one line per noted balance,
 * an expense or an income in the account's category. Every write that changes them makes them again
 * in its own transaction; this job does it once at every boot for every user, so that the balances
 * noted before v0.3 get theirs without waiting for the next one. It finds nothing to do once they
 * agree, and a run again adds nothing twice.
 */
export const balancesJob = defineJob({
  name: "remake-balance-lines",
  input: Schema.Struct({}),
  steps: BALANCE_LINES_STEPS,
  retries: { limit: 3, delaySeconds: 30, backoff: true },
  timeoutSeconds: 600,
  run: (_input, owner) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      yield* progress.step("remake");

      yield* remakeEveryBalanceLine(owner).pipe(
        Effect.provide(userData),
        Effect.mapError(
          (failed) => new JobFailed({ code: `QUERY_FAILED_${failed.code}`, retry: true }),
        ),
      );

      // At boot no page follows a month yet: none needs to read again.
      return { months: [] };
    }),
});
