import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { ImportSummary } from "./import-summary";
import type { ImportSummaryProps } from "./import-summary";

const SUMMARY: ImportSummaryProps = {
  label: "Import summary",
  read: { label: "lines read", count: 89 },
  added: { label: "added", count: 63 },
  known: { label: "already known", count: 24 },
  review: { label: "to review", count: 2 },
};

function Actions() {
  return (
    <>
      <Button variant="secondary" icon="undo">
        Undo
      </Button>
      <Button>Continue to the review</Button>
    </>
  );
}

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-4xl rounded-lg border bg-card p-6">{children}</div>;
}

/** The summary appears once the import ends: it unfolds. */
function Appearing() {
  const [done, setDone] = useState(false);

  return (
    <div className="flex flex-col items-start gap-4">
      <InBlock>
        {done ? (
          <ImportSummary {...SUMMARY} actions={<Actions />} />
        ) : (
          <p className="text-sm text-muted-foreground">Importing…</p>
        )}
      </InBlock>
      <Button variant="secondary" onClick={() => setDone(!done)}>
        {done ? "Start again" : "Finish the import"}
      </Button>
    </div>
  );
}

/** A second file adds its lines: the counts roll to the new totals. */
function Counting() {
  const [both, setBoth] = useState(false);

  return (
    <div className="flex flex-col items-start gap-4">
      <InBlock>
        <ImportSummary
          {...SUMMARY}
          read={{ label: "lines read", count: both ? 1315 : 89 }}
          added={{ label: "added", count: both ? 1267 : 63 }}
          known={{ label: "already known", count: both ? 48 : 24 }}
          review={{ label: "to review", count: both ? 0 : 2 }}
        />
      </InBlock>
      <Button variant="secondary" onClick={() => setBoth(!both)}>
        {both ? "One file" : "Add the second file"}
      </Button>
    </div>
  );
}

/**
 * An import's summary before moving on to the review (wireframe, screen 6, block 4): the lines
 * read, those added, those the app already had (duplicates skipped), and those held as near
 * duplicates for the review, which stand out while there are some; under them, a note when the
 * import has something to say beyond its counts. The page gives every label, the note
 * and its actions ("Undo", "Continue to the review"); the component writes the counts in the
 * page's language, in tabular figures.
 *
 * Accessibility: a labelled region and a list of terms; each count is heard whole, never a digit
 * on its way. It is no live region: the import's `JobProgress` announces the end.
 *
 * Motion: it unfolds when it first appears (revealed from its top and faded in, 250 ms, ease-out),
 * its note with it; each count
 * rolls from its previous value to the new one, as `Amount`'s digits do (200 ms). Under reduced
 * motion it appears and the numbers jump.
 *
 * Don't: write the counts into the labels ("63 added"), add a figure the import did not count,
 * or put more than the two actions under it.
 */
const meta = {
  title: "Import/Import summary",
  component: ImportSummary,
  args: { ...SUMMARY, actions: <Actions /> },
  render: (args) => (
    <InBlock>
      <ImportSummary {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof ImportSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

/** After the import: lines read, added, already known, to review; then the two actions. */
export const Default: Story = {};

/** Nothing held for the review: no figure stands out. */
export const NothingToReview: Story = {
  args: { review: { label: "to review", count: 0 } },
};

/** Every line was already known: a file imported twice. */
export const AllKnown: Story = {
  args: {
    read: { label: "lines read", count: 82 },
    added: { label: "added", count: 0 },
    known: { label: "already known", count: 82 },
    review: { label: "to review", count: 0 },
  },
};

/** The file stated a balance the import ignored: a note says so under the figures. */
export const WithNote: Story = {
  args: {
    review: { label: "to review", count: 0 },
    note: "This file's balance looks empty and was ignored: it says 0, while the account's lines make it something else that day.",
  },
};

/** Without actions, where the page shows them elsewhere. */
export const WithoutActions: Story = { args: { actions: undefined } };

/** It appears at the end of the import: it unfolds. */
export const Unfolding: Story = { render: () => <Appearing /> };

/** The counts change: their digits roll. */
export const Rolling: Story = { render: () => <Counting /> };

/** On a French page: the counts in French figures; the page gives the labels. */
export const French: Story = {
  args: {
    label: "Bilan de l'import",
    read: { label: "lignes lues", count: 1315 },
    added: { label: "ajoutées", count: 1267 },
    known: { label: "déjà connues", count: 46 },
    review: { label: "à vérifier", count: 2 },
    actions: undefined,
  },
  render: (args) => (
    <InFrench>
      <InBlock>
        <ImportSummary {...args} />
      </InBlock>
    </InFrench>
  ),
};

/** On a phone the figures sit two by two, the actions under them. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
