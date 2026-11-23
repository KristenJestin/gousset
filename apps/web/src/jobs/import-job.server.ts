import { IMPORT_STEPS, ImportJobInput, markFailed, runImport } from "@gousset/core";
import { Effect, Layer } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";
import { statementReader } from "./statement-reader.server";
import { FAILURES } from "./view";

/**
 * Importing a statement (#20): read, deduplicate, save (`runImport`), the steps the import screen
 * follows. Each attempt runs it again from the start, which it is written for: what an earlier
 * attempt saved is kept, never doubled. A database that did not answer is worth another attempt; a
 * file that cannot be read is not. The last attempt that ends unfinished, however it ends (a
 * failure worth another attempt, a defect, a timeout), marks the import failed, so that it can be
 * undone or run again rather than stay `reading` or `saving` for good.
 */
export const importJob = defineJob({
  name: "import-statement",
  input: ImportJobInput,
  steps: IMPORT_STEPS,
  retries: { limit: 2, delaySeconds: 5, backoff: true },
  timeoutSeconds: 600,
  run: (input, owner, attempt) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      const ended = (code: string) =>
        attempt.last
          ? markFailed(owner, input.importId, code).pipe(Effect.provide(userData))
          : Effect.void;

      const run = yield* runImport(owner, input, (step, counts) =>
        progress.step(step, counts),
      ).pipe(
        Effect.provide(Layer.mergeAll(userData, statementReader)),
        Effect.tapError((failed) => (failed.retry ? ended(failed.code) : Effect.void)),
        Effect.mapError((failed) => new JobFailed({ code: failed.code, retry: failed.retry })),
        Effect.tapDefect(() => ended(FAILURES.unexpected)),
        Effect.onInterrupt(() => ended(FAILURES.interrupted)),
      );

      return { months: [...run.months] };
    }),
});
