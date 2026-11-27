import { sweepReceipts } from "@gousset/core";
import { Clock, Effect, Layer, Schema } from "effect";

import { userData } from "../database.server";
import { receiptStorage } from "../receipts.server";
import { JobFailed, defineJob } from "./define";

const failed = () => new JobFailed({ code: "QUERY_FAILED", retry: false });

/**
 * Deletes, every hour, the receipts' files no row names any more (#217): those of lines deleted
 * with an undone import or an account, of users deleted, and of attachments that failed half way;
 * a receipt deleted by its user takes its file at once. Each user's rows are read in a transaction
 * of theirs (`UserData`), one after the other; the next sweep makes up for one that failed.
 */
export const receiptSweepJob = defineJob({
  name: "sweep-receipts",
  input: Schema.Struct({}),
  steps: ["sweep"],
  retries: { limit: 0, delaySeconds: 0, backoff: false },
  timeoutSeconds: 600,
  schedule: "17 * * * *",
  run: () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      yield* sweepReceipts(new Date(now)).pipe(
        Effect.provide(Layer.mergeAll(userData, receiptStorage)),
        Effect.mapError(failed),
      );

      return { months: [] };
    }),
});
