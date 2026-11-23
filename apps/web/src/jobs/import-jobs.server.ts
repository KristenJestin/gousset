import { ImportJobs, ImportUnavailable } from "@gousset/core";
import { Effect, Layer } from "effect";

import { importJob } from "./import-job.server";
import { JobQueue } from "./queue.server";
import { jobs } from "./runtime.server";

const sendImport = (owner: string, input: typeof importJob.input.Type) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;

    return yield* queue.send(importJob, owner, input);
  });

/** Where `@gousset/core`'s imports send their job: this process's queue (`jobs`). */
export const importJobs = Layer.succeed(ImportJobs, {
  send: (owner, input) =>
    Effect.tryPromise({
      try: async () => jobs.runPromise(sendImport(owner, input)),
      catch: () => new ImportUnavailable(),
    }),
});
