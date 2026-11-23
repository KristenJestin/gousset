import { IMPORT_STEPS, ImportJobInput, runImport } from "@gousset/core";
import { Effect, Layer } from "effect";

import { userData } from "../database.server";
import { JobFailed, JobProgress, defineJob } from "./define";
import { statementReader } from "./statement-reader.server";

/**
 * Importing a statement (#20): read, deduplicate, save (`runImport`), the steps the import screen
 * follows. Each attempt runs it again from the start, which it is written for: what an earlier
 * attempt saved is kept, never doubled. A database that did not answer is worth another attempt; a
 * file that cannot be read is not.
 */
export const importJob = defineJob({
  name: "import-statement",
  input: ImportJobInput,
  steps: IMPORT_STEPS,
  retries: { limit: 2, delaySeconds: 5, backoff: true },
  timeoutSeconds: 600,
  run: (input, owner) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      const run = yield* runImport(owner, input, (step, counts) =>
        progress.step(step, counts),
      ).pipe(
        Effect.provide(Layer.mergeAll(userData, statementReader)),
        Effect.mapError((failed) => new JobFailed({ code: failed.code, retry: failed.retry })),
      );

      return { months: [...run.months] };
    }),
});
