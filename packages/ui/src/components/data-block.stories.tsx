import type { Meta, StoryObj } from "@storybook/react-vite";

import { Amount } from "@gousset/ui/components/amount";
import { Button } from "@gousset/ui/components/button";
import {
  Block,
  FigureList,
  FigureListSkeleton,
  FigureMore,
  FigureRow,
} from "@gousset/ui/components/data-block";
import { ErrorState } from "@gousset/ui/components/error-state";

// Made-up figures, as packages/fixture's October 2026 has them.
const SPENDING = [
  { name: "Housing", minor: 69_000 },
  { name: "Groceries", minor: 43_819 },
  { name: "Transport", minor: 16_486 },
];

function Loaded() {
  return (
    <FigureList label="Where the money goes">
      {SPENDING.map((row) => (
        <FigureRow
          key={row.name}
          label={row.name}
          figure={<Amount value={{ minor: row.minor, currency: "EUR" }} locale="en" size="sm" />}
        />
      ))}
      <FigureMore>+ 4 more categories</FigureMore>
    </FigureList>
  );
}

/**
 * A block of a page and the states it goes through while its data loads (docs/architecture.md,
 * "Data loading and skeletons"): its rows, its skeleton of the same shape, its error with a retry.
 *
 * Motion: the skeleton stays invisible for 150 ms, then fades in (200 ms) and pulses; content that
 * replaces it in the browser fades in (200 ms). Under reduced motion both appear without moving.
 *
 * Don't: give a skeleton another number of rows than the block it stands for; the page would
 * jump when the data arrives. Don't put a block inside a block.
 */
const meta = {
  title: "Data/Block",
  component: Block,
  args: { title: "Where the money goes", children: <Loaded /> },
} satisfies Meta<typeof Block>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Loading: three rows and the "more" row, as the loaded block has. */
export const Loading: Story = {
  args: { children: <FigureListSkeleton rows={3} more /> },
};

/** Failed: the error stays in its block, with a retry. */
export const Failed: Story = {
  args: { children: <ErrorState onRetry={() => {}} /> },
};

/** A row with an action, as the lines to review have. */
export const WithAction: Story = {
  args: {
    title: "To review",
    children: (
      <FigureList label="To review">
        <FigureRow
          label="PAYLINK *PIXELPLAY"
          detail="Pixelplay · Leisure"
          figure={<Amount value={{ minor: -1499, currency: "EUR" }} locale="en" size="sm" />}
          action={<Button variant="secondary">Approve</Button>}
        />
      </FigureList>
    ),
  },
};
