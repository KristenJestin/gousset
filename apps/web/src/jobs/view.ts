import { Schema } from "effect";

/**
 * What a background job or an action changed: some months, or every month (a rule applied to the
 * past). The job's end says it, and the page that follows it refetches what is on screen
 * (`invalidateTouched`, docs/architecture.md, "Data loading and skeletons").
 */
export const Touched = Schema.Union([
  Schema.Struct({ months: Schema.Array(Schema.String) }),
  Schema.Struct({ everyMonth: Schema.Literal(true) }),
]);

export type Touched = typeof Touched.Type;

/**
 * Where a job stands, as the page that follows it reads it:
 *
 * - `waiting`: sent, not started yet;
 * - `running`: an attempt is under way;
 * - `retrying`: an attempt failed and another one is planned;
 * - `completed`, `failed`: over, for good.
 */
export const JobPhase = Schema.Literals(["waiting", "running", "retrying", "completed", "failed"]);

export type JobPhase = typeof JobPhase.Type;

/**
 * A job as its page sees it: its phase, the step it is at and the counts it reported, which
 * attempt it is on, and how it ended. Only identifiers, codes and counts: the page writes the words.
 */
export const JobView = Schema.Struct({
  id: Schema.String,
  /** The job's name, as it was defined (`defineJob`). */
  job: Schema.String,
  phase: JobPhase,
  /** The step reported last, by its id in the job's definition; none before the first. */
  step: Schema.NullOr(Schema.String),
  /** How much of the step is done, and out of how much, when the job counts it. */
  done: Schema.NullOr(Schema.Number),
  total: Schema.NullOr(Schema.Number),
  /** The attempt under way, the next one while waiting or retrying, the last one once over. */
  attempt: Schema.Number,
  /** How many attempts the job may take in all: its retries, plus one. */
  attempts: Schema.Number,
  /** Why it failed, as a code (`JobFailed`, or one of `FAILURES`), once failed or retrying. */
  failure: Schema.NullOr(Schema.String),
  /** What it changed, once completed. */
  touched: Schema.NullOr(Touched),
});

export type JobView = typeof JobView.Type;

/** The failures every job may end with, besides the codes its own definition fails with. */
export const FAILURES = {
  /**
   * The attempt was stopped from outside: the app stopped while it ran, or it outlived its
   * timeout. pg-boss failed it itself.
   */
  interrupted: "INTERRUPTED",
  /** A defect: the job's code broke. It is retried like any failure. */
  unexpected: "UNEXPECTED",
} as const;

/**
 * What a job's attempt leaves on its pg-boss row, and nothing else: what it touched, or the code
 * it failed with. Never a message or a stack, which pg-boss would keep in the database.
 */
export const JobOutput = Schema.Union([
  Schema.Struct({ touched: Touched }),
  Schema.Struct({ failure: Schema.String }),
]);

export type JobOutput = typeof JobOutput.Type;

/** A job's row in pg-boss, decoded: the part a view is made of. */
export type JobRecord = {
  readonly id: string;
  readonly name: string;
  readonly state: "created" | "retry" | "active" | "completed" | "cancelled" | "failed";
  /** pg-boss's count: 0 during the first attempt, raised as each later attempt starts. */
  readonly retryCount: number;
  readonly retryLimit: number;
  /** `null` when the row holds none, or something else than `JobOutput` (pg-boss's own). */
  readonly output: JobOutput | null;
};

const idle = { step: null, done: null, total: null, failure: null, touched: null };

/**
 * A job's view from its row alone, as a page reads it when no attempt of this process is under
 * way: after a restart, for a job another process ran, or once it is over. A row in `retry` has
 * had `retryCount + 1` attempts; the next is the one after.
 */
export function viewOfRecord(record: JobRecord): JobView {
  const base = {
    ...idle,
    id: record.id,
    job: record.name,
    attempt: record.retryCount + 1,
    attempts: record.retryLimit + 1,
  };

  const failure =
    record.output !== null && "failure" in record.output
      ? record.output.failure
      : FAILURES.interrupted;

  switch (record.state) {
    case "created":
      return { ...base, phase: "waiting" };
    case "active":
      return { ...base, phase: "running" };
    case "retry":
      return { ...base, phase: "retrying", attempt: record.retryCount + 2, failure };
    case "completed":
      return {
        ...base,
        phase: "completed",
        touched:
          record.output !== null && "touched" in record.output ? record.output.touched : null,
      };
    case "cancelled":
    case "failed":
      return { ...base, phase: "failed", failure };
  }
}

/** The job an attempt was claimed for, as pg-boss hands it to the worker. */
export type ClaimedJob = {
  readonly id: string;
  readonly name: string;
  readonly retryCount: number;
  readonly retryLimit: number;
};

/** An attempt starts: the first, or one after a failure. */
export function attemptStarted(job: ClaimedJob): JobView {
  return viewOfRecord({ ...job, state: "active", output: null });
}

/** How much of its step a job reports done, and out of how much when it knows. */
export type StepCounts = { readonly done: number; readonly total?: number };

/** The job reports a step, with its counts when it counts something. */
export function stepReported(view: JobView, step: string, counts?: StepCounts): JobView {
  return { ...view, step, done: counts?.done ?? null, total: counts?.total ?? null };
}

/**
 * How an attempt ended, as the job's run said it: what it touched, or a failure, which `retry`
 * says is worth another attempt (a broken file is not; a database that did not answer is).
 */
export type AttemptOutcome =
  | { readonly touched: Touched }
  | { readonly failure: string; readonly retry: boolean };

/**
 * The view once an attempt ended: completed, retrying while attempts remain and the failure is
 * worth another, failed otherwise. The step and counts of the last attempt stay on a failure, so
 * that the page can say where it stopped.
 */
export function attemptEnded(view: JobView, outcome: AttemptOutcome): JobView {
  if ("touched" in outcome) {
    return { ...view, phase: "completed", failure: null, touched: outcome.touched };
  }

  if (outcome.retry && view.attempt < view.attempts) {
    return { ...view, phase: "retrying", attempt: view.attempt + 1, failure: outcome.failure };
  }

  return { ...view, phase: "failed", failure: outcome.failure };
}

/** Whether the job is over: nothing more will change. */
export function isOver(view: JobView): boolean {
  return view.phase === "completed" || view.phase === "failed";
}

/** Whether two views say the same: a page is sent a view only when it changed. */
export function sameView(a: JobView, b: JobView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
