import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { JobProgress } from "./job-progress";
import type { JobProgressProps } from "./job-progress";

const STEPS = [
  { id: "read", label: "Reading the file" },
  { id: "match", label: "Finding duplicates and transfers" },
  { id: "rules", label: "Applying your rules" },
  { id: "save", label: "Saving the lines" },
];

const running: JobProgressProps = {
  title: "Importing statement-october.ofx",
  steps: STEPS,
  phase: "running",
  step: "match",
  done: 312,
  total: 1204,
  attempt: 1,
  attempts: 3,
};

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-md rounded-lg border bg-card p-6">{children}</div>;
}

/** Each press moves the job on: through every step, counting the second one, then done. */
const MOVES: ReadonlyArray<Pick<JobProgressProps, "phase" | "step" | "done" | "total">> = [
  { phase: "waiting", step: null, done: null, total: null },
  { phase: "running", step: "read", done: null, total: null },
  { phase: "running", step: "match", done: 300, total: 1204 },
  { phase: "running", step: "match", done: 900, total: 1204 },
  { phase: "running", step: "rules", done: null, total: null },
  { phase: "running", step: "save", done: null, total: null },
  { phase: "completed", step: "save", done: null, total: null },
];

function AdvancingJob() {
  const [at, setAt] = useState(0);
  const move = MOVES[at] ?? MOVES[0];

  return (
    <div className="flex flex-col items-start gap-4">
      <InBlock>
        <JobProgress {...running} {...move} result="1,204 lines read, 37 to review" />
      </InBlock>
      <Button variant="secondary" onClick={() => setAt((at + 1) % MOVES.length)}>
        Next step
      </Button>
    </div>
  );
}

/**
 * A background job followed live: an import, a rule applied to the past. Its title and where it
 * stands, a bar, every step with the counts of the one under way, and, once failed, what to do
 * with a button to try again. The page writes the title, the steps, the failure and the result
 * (they name the user's data); the component writes the states ("Step 2 of 4", "Retrying: attempt
 * 2 of 3", "Done") and the counts, in the page's language.
 *
 * Accessibility: the state is a live region, so each new step, a retry and the end are heard; the
 * bar is a `progressbar` with its value; a failure is an alert.
 *
 * Motion: the bar grows to each new value in 200 ms (ease-out) and the current step's loader
 * turns; under reduced motion the bar jumps and the loader pulses. Steps change state in place:
 * nothing shifts while the job runs.
 *
 * Don't: show it for an action that ends at once (a button's `loading` is enough), invent a
 * percentage the job did not report, or put it in a block inside a block.
 */
const meta = {
  title: "Feedback/Job progress",
  component: JobProgress,
  args: running,
  render: (args) => (
    <InBlock>
      <JobProgress {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof JobProgress>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Sent, not started yet. */
export const Waiting: Story = {
  args: { phase: "waiting", step: null, done: null, total: null },
};

/** Under way, counting the lines of its second step. */
export const Running: Story = {};

/** An attempt failed; the next one is planned. The step it stopped at is marked. */
export const Retrying: Story = {
  args: { phase: "retrying", attempt: 2, done: null, total: null },
};

/** Done, with what it did. */
export const Completed: Story = {
  args: { phase: "completed", step: "save", result: "1,204 lines read, 37 to review" },
};

/** Failed for good: what happened, what to do, and a button to try again. */
export const Failed: Story = {
  args: {
    phase: "failed",
    step: "read",
    done: null,
    total: null,
    attempt: 3,
    failure:
      "The file could not be read three times in a row. Check that it is a bank statement, then try again.",
    onRetry: () => undefined,
  },
};

/** Moves on at each press of the button: the bar grows, the steps tick. */
export const Advancing: Story = { render: () => <AdvancingJob /> };

/** On a French page (`<html lang="fr">`): the states and the counts in French. */
export const French: Story = {
  args: {
    title: "Import de releve-octobre.ofx",
    steps: [
      { id: "read", label: "Lecture du fichier" },
      { id: "match", label: "Doublons et virements" },
      { id: "rules", label: "Application de vos règles" },
      { id: "save", label: "Enregistrement des lignes" },
    ],
  },
  render: (args) => (
    <InFrench>
      <InBlock>
        <JobProgress {...args} />
      </InBlock>
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
