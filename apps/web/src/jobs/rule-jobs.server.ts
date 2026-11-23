import { RuleJobUnavailable, RuleJobs } from "@gousset/core";
import type { RuleJobInput, RuleJobOutcome } from "@gousset/core";
import { Effect, Layer } from "effect";

import { JobQueue } from "./queue.server";
import { ruleJob } from "./rule-job.server";
import { jobs } from "./runtime.server";

const sendRule = (owner: string, input: RuleJobInput) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;

    return yield* queue.send(ruleJob, owner, input);
  });

const outcomeOf = (owner: string, jobId: string) =>
  Effect.gen(function* () {
    const queue = yield* JobQueue;
    const view = yield* queue.view(jobId, owner);

    if (view === null || view.phase === "failed") {
      return { state: "failed" } satisfies RuleJobOutcome;
    }

    return view.phase === "completed"
      ? ({ state: "done", changed: view.done ?? 0 } satisfies RuleJobOutcome)
      : ({ state: "running" } satisfies RuleJobOutcome);
  });

/** Where `@gousset/core`'s rules send the job applying one to the past: this process's queue. */
export const ruleJobs = Layer.succeed(RuleJobs, {
  send: (owner, input) =>
    Effect.tryPromise({
      try: async () => jobs.runPromise(sendRule(owner, input)),
      catch: () => new RuleJobUnavailable(),
    }),
  outcome: (owner, jobId) =>
    Effect.tryPromise({
      try: async (): Promise<RuleJobOutcome> => jobs.runPromise(outcomeOf(owner, jobId)),
      catch: () => new RuleJobUnavailable(),
    }),
});
