/**
 * Where a background job stands, as `JobProgress` draws it: the phases of the app's jobs
 * (apps/web/src/jobs/view.ts), without the app's types.
 */
export type JobPhase = "waiting" | "running" | "retrying" | "completed" | "failed";

/** Each step of a job, as its row reads: done, under way, where it stopped, or still to come. */
export type StepState = "done" | "current" | "stopped" | "pending";

export type JobPosition = {
  readonly phase: JobPhase;
  /** The steps' ids, in order. */
  readonly steps: ReadonlyArray<string>;
  /** The step reported last, by id; `null` before the first. */
  readonly step: string | null;
  readonly done: number | null;
  readonly total: number | null;
};

/** The index of the step reported last, -1 before the first or for an id not in the list. */
function stepIndex({ steps, step }: JobPosition): number {
  return step === null ? -1 : steps.indexOf(step);
}

/**
 * How far the job went, 0 to 100: each step weighs the same, and the step under way counts for
 * the part of it done when it counts something. A completed job is at 100; a failed one stays
 * where it stopped.
 */
export function jobPercent(position: JobPosition): number {
  if (position.phase === "completed") {
    return 100;
  }

  const index = stepIndex(position);

  if (index < 0 || position.steps.length === 0) {
    return 0;
  }

  const { done, total } = position;
  const part = done !== null && total !== null && total > 0 ? Math.min(done / total, 1) : 0;

  return ((index + part) / position.steps.length) * 100;
}

/** Each step's state, in the steps' order. */
export function stepStates(position: JobPosition): ReadonlyArray<StepState> {
  const index = stepIndex(position);

  return position.steps.map((_, at) => {
    if (position.phase === "completed" || at < index) {
      return "done";
    }

    if (at > index) {
      return "pending";
    }

    return position.phase === "running" ? "current" : "stopped";
  });
}
