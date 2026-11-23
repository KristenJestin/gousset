import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Card } from "./card";
import { FileDrop } from "./file-drop";
import type { FileDropProps } from "./file-drop";

const ACCEPT = ".ofx,.qif,.xml,.sta,.mt940,.csv";

/** Says what the last drop or pick handed over, so a test can read it. */
function Receiving({ props }: { props: FileDropProps }) {
  const [calls, setCalls] = useState<Array<ReadonlyArray<File>>>([]);
  const last = calls.at(-1);

  return (
    <div className="flex w-full max-w-3xl flex-col gap-3">
      <FileDrop {...props} onFiles={(files) => setCalls([...calls, files])} />
      <p role="status" data-testid="received" className="text-sm text-muted-foreground">
        {last === undefined
          ? "Nothing received yet."
          : `Call ${String(calls.length)}: ${last.map((file) => file.name).join(", ")}`}
      </p>
    </div>
  );
}

/**
 * Where statement files come in: dropped on the zone, or chosen with its button, which opens the
 * file picker. The button is the way in for the keyboard, screen readers and phones; the zone is
 * a shortcut for a mouse. One drop or one pick calls `onFiles` once, with every file of it. The
 * page writes the label and the formats; the component writes "Choose files".
 *
 * The picker keeps to `accept`; a drop takes what it is given, so the page still checks each
 * file (an unknown one becomes a row to map, not an error here).
 *
 * Motion: while files are dragged over it, the zone's border turns to the accent and its
 * background darkens a step, in 150 ms (ease-out); cut under reduced motion.
 *
 * Don't: make the zone the only way in, put it in a block of its own beside the files' table
 * (one block), or use it for a single setting's file (a plain button is enough).
 */
const meta = {
  title: "Import/File drop",
  component: FileDrop,
  args: {
    label: "Drop your statements here",
    description: "OFX, QIF, CAMT.053, MT940 or CSV",
    accept: ACCEPT,
    onFiles: () => undefined,
  },
  render: (args) => <Receiving props={args} />,
} satisfies Meta<typeof FileDrop>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Waiting for files: drop some on it, or choose them. */
export const Default: Story = {};

/** Without the line of formats. */
export const LabelOnly: Story = { args: { description: undefined } };

/** While an import is being sent: neither the button nor a drop takes files. */
export const Disabled: Story = { args: { disabled: true } };

/** Where it lives: at the top of the import's block, above the files' table. */
export const InABlock: Story = {
  render: (args) => (
    <Card title="Import statements" description="Step 1 of 3: drop the files">
      <FileDrop {...args} />
    </Card>
  ),
};

/** On a French page: the button in French; the page gives its own words. */
export const French: Story = {
  args: {
    label: "Déposez vos relevés ici",
    description: "OFX, QIF, CAMT.053, MT940 ou CSV",
  },
  render: (args) => (
    <InFrench>
      <Receiving props={args} />
    </InFrench>
  ),
};

/** On a phone the zone stacks, and its button is the way in. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
