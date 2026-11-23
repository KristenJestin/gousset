import { createServerFn } from "@tanstack/react-start";
import { Effect, Option, Schema } from "effect";

import { JobQueue } from "@/jobs/queue.server";
import { e2eJobs, jobs } from "@/jobs/runtime.server";
import { TestJobInput, testJob } from "@/jobs/test-job";

import { signedIn } from "./month";

/** Whether the harness's job page exists (`/e2e/jobs`): only when the harness started the app. */
export const e2eJobsEnabled = createServerFn({ method: "GET" }).handler(() =>
  Effect.runPromise(Effect.map(e2eJobs, Option.isSome)),
);

/** Sends the harness's test job for the signed-in user; refused outside a test run. */
export const startTestJob = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(TestJobInput))
  .handler(({ data, context }) =>
    jobs.runPromise(
      Effect.gen(function* () {
        if (Option.isNone(yield* e2eJobs)) {
          return yield* Effect.die("Only the end-to-end harness sends the test job.");
        }

        const queue = yield* JobQueue;

        return { id: yield* queue.send(testJob, context.owner, data) };
      }),
    ),
  );

/**
 * The signed-in user's last jobs and where each stands, for the development panel
 * (`src/devtools.tsx`); nothing outside development.
 */
export const listJobs = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) =>
    import.meta.env.DEV
      ? jobs.runPromise(JobQueue.use((queue) => queue.list(context.owner)))
      : Promise.resolve([]),
  );
