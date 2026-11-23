import { ImportJobs, ImportUnavailable } from "@gousset/core";
import { Effect, Layer } from "effect";

import { importJob } from "./import-job.server";
import { JobQueue } from "./queue.server";
import { jobs } from "./runtime.server";
import { isOver } from "./view";

const sendImport = (owner: string, input: typeof importJob.input.Type) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;

    return yield* queue.send(importJob, owner, input);
  });

/** Whether the job is over; one the queue no longer knows (purged) is over too. */
const jobIsOver = (owner: string, jobId: string) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const view = yield* queue.view(jobId, owner);

    return view === null || isOver(view);
  });

/** Where `@gousset/core`'s imports send their job: this process's queue (`jobs`). */
export const importJobs = Layer.succeed(ImportJobs, {
  send: (owner, input) =>
    Effect.tryPromise({
      try: async () => jobs.runPromise(sendImport(owner, input)),
      catch: () => new ImportUnavailable(),
    }),
  // A queue that does not answer says nothing is over: the import is left as it is.
  isOver: (owner, jobId) =>
    Effect.tryPromise({
      try: async () => jobs.runPromise(jobIsOver(owner, jobId)),
      catch: () => new ImportUnavailable(),
    }).pipe(Effect.orElseSucceed(() => false)),
});
