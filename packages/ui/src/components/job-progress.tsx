import { motion } from "motion/react";

import { useAnimatedPercent } from "../hooks/use-animated-percent";
import { useUiMessages } from "../hooks/use-ui-messages";
import { jobPercent, stepStates } from "../lib/job-progress";
import type { JobPhase, StepState } from "../lib/job-progress";
import type { UiMessages } from "../lib/messages";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Icon } from "./icon";
import { Loader } from "./loader";

export type { JobPhase } from "../lib/job-progress";

export type JobProgressStep = {
  id: string;
  /** What the step does, in the page's words ("Reading the file"). */
  label: string;
};

export type JobProgressProps = {
  /** What the job does, naming the user's data ("Importing statement.ofx"). */
  title: string;
  /** Every step, in order. */
  steps: ReadonlyArray<JobProgressStep>;
  phase: JobPhase;
  /** The step reported last, by id: the one under way, or where the job stopped. */
  step: string | null;
  /** How much of that step is done, and out of how much, when the job counts it. */
  done: number | null;
  total: number | null;
  /** The attempt under way (or the next one, while retrying), and how many the job may take. */
  attempt: number;
  attempts: number;
  /** Once failed: what went wrong and what to do about it, in the page's words. Announced. */
  failure?: string;
  /** Once completed: what it did ("312 lines updated"). Announced. */
  result?: string;
  /** Adds "Try again" once failed. A promise keeps the button busy until it settles. */
  onRetry?: () => Promise<void> | void;
  /** The page's language (`<html lang>`) unless given: it writes the counts. */
  locale?: string;
};

function statusOf(messages: UiMessages["jobs"], props: JobProgressProps): string {
  const index = props.step === null ? -1 : props.steps.findIndex(({ id }) => id === props.step);

  switch (props.phase) {
    case "waiting":
      return messages.waiting;
    case "running":
      return messages.step(Math.max(index, 0) + 1, props.steps.length);
    case "retrying":
      return messages.retrying(props.attempt, props.attempts);
    case "completed":
      return messages.completed;
    case "failed":
      return messages.failed(props.attempt);
  }
}

function StepMark({ state }: { state: StepState }) {
  switch (state) {
    case "done":
      return (
        <span className="flex text-primary">
          <Icon name="check" size="sm" />
        </span>
      );
    case "current":
      return (
        <span className="flex text-primary">
          <Loader size="sm" />
        </span>
      );
    case "stopped":
      return (
        <span className="flex text-destructive">
          <Icon name="warning" size="sm" />
        </span>
      );
    case "pending":
      return <span className="mx-1 size-1.5 rounded-full bg-muted-foreground" />;
  }
}

/**
 * A background job followed live (docs/design.md, "Import": the steps advance with the real
 * progress): its title and where it stands, a bar, its steps with the counts of the one under
 * way, and, once failed, what to do with a button to try again. The page gives every word that
 * names the user's data; this component writes the states and the counts.
 *
 * The state beside the title is a live region: screen readers hear each new step, a retry, the
 * end. The bar is a `progressbar` with its value.
 *
 * Motion: the bar grows to each new value in 200 ms (ease-out), and the current step's loader
 * turns; cut under reduced motion (the bar jumps, the loader pulses). Steps change state without
 * moving: nothing shifts while the job runs.
 */
export function JobProgress(props: JobProgressProps) {
  const messages = useUiMessages().jobs;
  const { title, steps, phase, done, total, failure, result, onRetry, locale } = props;
  const position = { phase, steps: steps.map(({ id }) => id), step: props.step, done, total };
  const percent = jobPercent(position);
  const states = stepStates(position);
  const width = useAnimatedPercent(percent);
  const status = statusOf(messages, props);
  const number = new Intl.NumberFormat(locale);

  return (
    <div data-slot="job-progress" data-phase={phase} className="flex flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{title}</p>
        <p
          role="status"
          data-slot="job-progress-status"
          className={cn(
            "shrink-0 text-sm tabular-nums",
            phase === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={status}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <svg className="block size-full" aria-hidden="true">
          <motion.rect
            data-slot="job-progress-fill"
            y="0"
            height="100%"
            width={width}
            className={phase === "failed" ? "fill-destructive" : "fill-primary"}
          />
        </svg>
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, at) => {
          const state = states[at] ?? "pending";

          return (
            <li
              key={step.id}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
              className="flex h-5 min-w-0 items-center gap-2 text-sm"
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <StepMark state={state} />
              </span>
              <span
                className={cn(
                  "min-w-0 truncate",
                  state === "pending" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
              </span>
              {state === "current" && done !== null && total !== null ? (
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  {messages.counts(number.format(done), number.format(total))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div role="alert" className="flex flex-col items-start gap-3 empty:hidden">
        {phase === "failed" && failure !== undefined ? (
          <p className="text-sm text-foreground">{failure}</p>
        ) : null}
        {phase === "failed" && onRetry !== undefined ? (
          <Button variant="secondary" size="sm" icon="retry" onClick={() => onRetry()}>
            {messages.retry}
          </Button>
        ) : null}
      </div>
      <p role="status" className="text-sm text-foreground empty:hidden">
        {phase === "completed" ? result : undefined}
      </p>
    </div>
  );
}
