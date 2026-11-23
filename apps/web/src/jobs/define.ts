import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { StepCounts, Touched } from "./view";

/**
 * How a job's run fails on purpose, with a code its page translates into what to do. `retry` says
 * whether another attempt may succeed: a database that did not answer, yes; a file that cannot be
 * read, no, and the job fails at once. Anything else that breaks is a defect, retried as
 * `UNEXPECTED` (`FAILURES`).
 */
export class JobFailed extends Schema.TaggedError<JobFailed>()("JobFailed", {
  code: Schema.String,
  retry: Schema.Boolean,
}) {}

/**
 * Where a running job reports its progress: the step it is at, by its id in the job's `steps`, and
 * how much of it is done when it counts something. The page that started the job sees it at once.
 * Report a few times a second at most: each report goes to every page following the job.
 */
export class JobProgress extends Context.Service<
  JobProgress,
  { readonly step: (step: string, counts?: StepCounts) => Effect.Effect<void> }
>()("@gousset/web/JobProgress") {}

/** A job, defined once: its input, its steps, its retries, its timeout and what it does. */
export type JobDefinition<Input, Encoded> = {
  /** Its queue's name in pg-boss, and its name in telemetry: never renamed once released. */
  readonly name: string;
  /** Its input, checked when it is sent and again when an attempt starts. Stored as JSON. */
  readonly input: Schema.Codec<Input, Encoded>;
  /** Its steps' ids, in order: the page shows them all and moves through them. */
  readonly steps: ReadonlyArray<string>;
  readonly retries: {
    /** How many attempts after the first one fails. */
    readonly limit: number;
    /** Seconds before the next attempt; doubled at each attempt with `backoff`. */
    readonly delaySeconds: number;
    readonly backoff: boolean;
  };
  /** Seconds an attempt may run: past it, pg-boss stops it, and it counts as failed. */
  readonly timeoutSeconds: number;
  /**
   * What it does, for the user who sent it, ending on what it touched for their pages to read
   * again. It is run again from the start on each attempt, so it must not double what an earlier
   * attempt did.
   */
  readonly run: (input: Input, owner: string) => Effect.Effect<Touched, JobFailed, JobProgress>;
};

/** A job's definition, typed from its input's schema. */
export function defineJob<Input, Encoded>(
  definition: JobDefinition<Input, Encoded>,
): JobDefinition<Input, Encoded> {
  return definition;
}

/**
 * How long a job's worker may go silent before pg-boss takes its attempt for dead (a process that
 * crashed or was killed): the next supervision fails it, and it is retried. pg-boss's minimum.
 */
export const HEARTBEAT_SECONDS = 10;

/** pg-boss's options for each job sent: the definition's retries and timeout. */
export function sendOptions(
  definition: Pick<JobDefinition<never, never>, "retries" | "timeoutSeconds">,
) {
  return {
    retryLimit: definition.retries.limit,
    retryDelay: definition.retries.delaySeconds,
    retryBackoff: definition.retries.backoff,
    expireInSeconds: definition.timeoutSeconds,
    heartbeatSeconds: HEARTBEAT_SECONDS,
  };
}
