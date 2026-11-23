import { recogniseMerchants } from "@gousset/core";
import { Effect, Schema } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";

/** The recognition's one step. */
export const RECOGNISE_STEPS = ["recognise"] as const;

/**
 * Recognising a user's merchants (#24): the merchant of every line whose cleaned label names none
 * yet. Each import does it at its end; this job does it once at every boot for every user, so that
 * the lines kept before merchants existed (v0.2) get theirs without waiting for an import. It finds
 * nothing to do once they have them, and a run again adds nothing twice.
 */
export const merchantsJob = defineJob({
  name: "recognise-merchants",
  input: Schema.Struct({}),
  steps: RECOGNISE_STEPS,
  retries: { limit: 3, delaySeconds: 30, backoff: true },
  timeoutSeconds: 600,
  run: (_input, owner) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      yield* progress.step("recognise");

      yield* recogniseMerchants(owner).pipe(
        Effect.provide(userData),
        Effect.mapError(
          (failed) => new JobFailed({ code: `QUERY_FAILED_${failed.code}`, retry: true }),
        ),
      );

      // The merchants are no month's: no page that follows a month reads anything new.
      return { months: [] };
    }),
});
