import { Effect, Schema } from "effect";

import { JobFailed, JobProgress, defineJob } from "./define";

/**
 * Set to `on` by the end-to-end harness only (`apps/e2e/src/app-server.ts`): the test job and its
 * page (`/e2e/jobs`) exist then, and only then. An installation never sets it.
 */
export const E2E_JOBS_VARIABLE = "GOUSSET_E2E_JOBS";

/** The test job's steps, in order. */
export const TEST_JOB_STEPS = ["prepare", "count", "finish"] as const;

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const TestJobInput = Schema.Struct({
  /** The month it says it touched: the page that follows it reads that month again. */
  month: Schema.String,
  /** How many items its counting step counts, one at a time. */
  count: Count,
  /** How long each item takes, in milliseconds. */
  itemMs: Count,
  /** How many of its attempts fail, on purpose, before one succeeds. */
  failures: Count,
  /** Names this run, so that its failures are counted apart from any other's. */
  key: Schema.String,
});

/** The attempts that failed so far, by run: in this process's memory, which a restart forgets. */
const failedSoFar = new Map<string, number>();

/**
 * The harness's job (apps/e2e/tests/jobs.spec.ts): it prepares, counts `count` items reporting
 * each one, then finishes, failing its first `failures` attempts there with `TEST_FAILURE`.
 * Two retries a second apart: three attempts in all.
 */
export const testJob = defineJob({
  name: "e2e-test",
  input: TestJobInput,
  steps: TEST_JOB_STEPS,
  retries: { limit: 2, delaySeconds: 1, backoff: false },
  timeoutSeconds: 120,
  run: ({ month, count, itemMs, failures, key }) =>
    Effect.gen(function* () {
      const progress = yield* JobProgress;

      yield* progress.step("prepare");
      yield* Effect.sleep(itemMs);

      for (let done = 0; done < count; done += 1) {
        yield* progress.step("count", { done, total: count });
        yield* Effect.sleep(itemMs);
      }

      yield* progress.step("count", { done: count, total: count });
      yield* progress.step("finish");

      const failed = failedSoFar.get(key) ?? 0;

      if (failed < failures) {
        failedSoFar.set(key, failed + 1);

        return yield* new JobFailed({ code: "TEST_FAILURE", retry: true });
      }

      return { months: [month] };
    }),
});
