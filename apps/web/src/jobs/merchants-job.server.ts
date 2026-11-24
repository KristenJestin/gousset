import { matchTopUps, recogniseMerchants } from "@gousset/core";
import type { QueryFailed } from "@gousset/db/user-data";
import { Effect, Schema } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";

/** The recognition's steps: the merchants, then the top-ups their entries are classified for. */
export const RECOGNISE_STEPS = ["recognise", "top-ups"] as const;

const failed = (query: QueryFailed) =>
  new JobFailed({ code: `QUERY_FAILED_${query.code}`, retry: true });

/**
 * Recognising a user's merchants (#24): the merchant of every line whose cleaned label names none
 * yet. Each import does it at its end; this job does it once at every boot for every user, so that
 * the lines kept before merchants existed (v0.2) get theirs without waiting for an import. Then the
 * meal-voucher top-ups are matched (#28), once their lines are classified by their merchants, so
 * that the lines kept before v0.3 are matched too. It finds nothing to do once they have them, and a
 * run again adds nothing twice.
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

      yield* recogniseMerchants(owner).pipe(Effect.provide(userData), Effect.mapError(failed));

      yield* progress.step("top-ups");

      yield* matchTopUps(owner).pipe(Effect.provide(userData), Effect.mapError(failed));

      // The merchants are no month's: no page that follows a month reads anything new.
      return { months: [] };
    }),
});
