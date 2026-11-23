import { Config, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";

import { ENV } from "../env.server";
import { telemetry } from "../telemetry.server";
import { importJob } from "./import-job.server";
import { JobQueue, register } from "./queue.server";
import { E2E_JOBS_VARIABLE, testJob } from "./test-job";

/** Present only when the harness started the app; any value but `on` fails loudly. */
export const e2eJobs = Config.option(Config.Literal("on", E2E_JOBS_VARIABLE));

/** Every job of the app; the harness's test job only when it started the app. */
const queue = Layer.unwrap(
  Effect.gen(function* () {
    const testing = Option.isSome(yield* e2eJobs);
    const jobs = [register(importJob)];

    return JobQueue.layer(ENV.DATABASE_URL, testing ? [...jobs, register(testJob)] : jobs);
  }).pipe(Effect.orDie),
);

/**
 * The job queue of this process, for the server routes and functions that send and follow jobs.
 * Built once, by `startJobs` at boot; released when the process stops.
 */
export const jobs = ManagedRuntime.make(queue);

let started = false;

/**
 * Starts the queue when the server starts (`src/server.ts`): pg-boss resumes the jobs a previous
 * run left, and the workers wait for new ones. On SIGTERM or SIGINT the queue stops first,
 * giving the attempts under way a few seconds before pg-boss fails them for the next start to
 * retry, then the signal goes on to whatever else listens (the server's own graceful stop), or
 * ends the process as it would have.
 */
export function startJobs(): void {
  if (started) {
    return;
  }

  started = true;

  // Reaching the queue builds it: pg-boss starts, and each job's worker with it.
  const reached = Effect.gen(function* () {
    yield* JobQueue;
  });

  void jobs.runPromiseExit(reached).then((exit) => {
    if (Exit.isFailure(exit)) {
      telemetry.runFork(Effect.logError("The job queue did not start", exit.cause));
    }
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void jobs.dispose().finally(() => {
        process.kill(process.pid, signal);
      });
    });
  }
}
