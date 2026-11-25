import { pairEveryLine, transfersLayer } from "@gousset/core";
import { Effect, Layer, Schema } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";

/** The pairing's one step. */
export const PAIR_TRANSFERS_STEPS = ["pair"] as const;

/**
 * The transfers between a user's own accounts (#26, #192): each import pairs its lines with the
 * lines already there, in the transaction that ends it, but the lines kept before v0.3 never went
 * through one. This job runs the import's automatic pairing once at every boot for every user, over
 * every line, in one transaction: a line and its only candidate are paired, a line with several
 * waits in the review, and a line the user said is no transfer, or linked to an expense, is left
 * alone. It finds nothing to do once the clear pairs are paired, and a run again adds nothing.
 */
export const transfersJob = defineJob({
  name: "pair-transfers",
  input: Schema.Struct({}),
  steps: PAIR_TRANSFERS_STEPS,
  retries: { limit: 3, delaySeconds: 30, backoff: true },
  timeoutSeconds: 600,
  run: (_input, owner) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      yield* progress.step("pair");

      const written = yield* pairEveryLine(owner).pipe(
        Effect.provide(transfersLayer.pipe(Layer.provide(userData))),
        Effect.mapError(
          (failed) => new JobFailed({ code: `QUERY_FAILED_${failed.code}`, retry: true }),
        ),
      );

      yield* progress.step("pair", { done: written.paired + written.cardDebits });

      // At boot no page follows a month yet: none needs to read again.
      return { months: [] };
    }),
});
