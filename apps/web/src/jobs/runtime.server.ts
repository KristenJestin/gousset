import { listUsers } from "@gousset/auth/users";
import { appConnection } from "@gousset/db/app-role";
import { Config, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";

import { db } from "../database.server";
import { ENV } from "../env.server";
import { telemetry } from "../telemetry.server";
import { balancesJob } from "./balances-job.server";
import { importJob } from "./import-job.server";
import { merchantsJob } from "./merchants-job.server";
import { JobQueue, register } from "./queue.server";
import { ruleJob } from "./rule-job.server";
import { E2E_JOBS_VARIABLE, testJob } from "./test-job";
import { uploadSweepJob } from "./upload-sweep.server";

/** Present only when the harness started the app; any value but `on` fails loudly. */
export const e2eJobs = Config.option(Config.Literal("on", E2E_JOBS_VARIABLE));

/** Every job of the app; the harness's test job only when it started the app. */
const queue = Layer.unwrap(
  Effect.gen(function* () {
    const testing = Option.isSome(yield* e2eJobs);

    const jobs = [
      register(importJob),
      register(uploadSweepJob),
      register(merchantsJob),
      register(balancesJob),
      register(ruleJob),
    ];

    // As the app's role, which owns pg-boss's schema (#66), never as the tables' owner.
    return JobQueue.layer(
      appConnection(ENV.DATABASE_URL),
      testing ? [...jobs, register(testJob)] : jobs,
    );
  }).pipe(Effect.orDie),
);

/**
 * The job queue of this process, for the server routes and functions that send and follow jobs.
 * Built once, by `startJobs` at boot; released when the process stops.
 */
export const jobs = ManagedRuntime.make(queue);

/**
 * Every user's merchants recognised once at boot (#24), and the movement lines of their accounts
 * kept by their balance made (#31): what was kept before merchants and movement lines existed gets
 * them after the update, without waiting for an import or a balance noted. The app's role reads the
 * users, never their lines: each user's jobs read their own through `UserData`, and find nothing to
 * do once every line has its merchant and every noted balance its line.
 */
const recogniseEveryone = Effect.gen(function* () {
  const queued = yield* JobQueue;
  const users = yield* Effect.tryPromise(async () => listUsers(db));

  for (const user of users) {
    yield* queued.send(merchantsJob, user.id, {});
    yield* queued.send(balancesJob, user.id, {});
  }
});

let started = false;

/**
 * Starts the queue when the server starts (`src/server.ts`): pg-boss resumes the jobs a previous
 * run left, and the workers wait for new ones; then every user's merchants are recognised. On
 * SIGTERM or SIGINT the queue stops first, giving the attempts under way a few seconds before
 * pg-boss fails them for the next start to retry, then the signal goes on to whatever else listens
 * (the server's own graceful stop), or ends the process as it would have.
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

      return;
    }

    void jobs.runPromiseExit(recogniseEveryone).then((recognised) => {
      if (Exit.isFailure(recognised)) {
        telemetry.runFork(
          Effect.logWarning("The merchants were not recognised at boot", recognised.cause),
        );
      }
    });
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void jobs.dispose().finally(() => {
        process.kill(process.pid, signal);
      });
    });
  }
}
