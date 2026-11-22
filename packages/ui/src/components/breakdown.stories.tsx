import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { CATEGORIES, MERCHANTS, PREVIOUS_CATEGORIES } from "../stories/made-up";
import type { MadeUpCategory } from "../stories/made-up";
import { Breakdown, BreakdownSkeleton } from "./breakdown";
import type { BreakdownRow } from "./breakdown";
import { Button } from "./button";

function rowsOf(categories: ReadonlyArray<MadeUpCategory>): Array<BreakdownRow> {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    icon: category.icon,
    amount: category.spent,
    benchmark: category.benchmark,
  }));
}

const october = rowsOf(CATEGORIES);

/** The list, with what a click chose written under it. */
function Choosing({ limit }: { limit?: number }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Breakdown
        rows={october}
        limit={all ? undefined : limit}
        onSelect={setChosen}
        onMore={() => setAll(true)}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        {chosen === null ? "Nothing chosen" : `Chosen: ${chosen}`}
      </p>
    </div>
  );
}

/** Switches between this month and the one before: the bars grow, the amounts roll. */
function SwitchingMonths() {
  const [current, setCurrent] = useState(true);

  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <div className="w-full">
        <Breakdown rows={current ? october : rowsOf(PREVIOUS_CATEGORIES)} limit={5} />
      </div>
      <Button variant="secondary" onClick={() => setCurrent(!current)}>
        {current ? "Previous month" : "Next month"}
      </Button>
    </div>
  );
}

/**
 * Where the money goes (screen 1, block 2): one row per category, merchant or subject, with its
 * icon, its name, a bar and its amount in whole units. Every bar is on one scale, the largest
 * amount or benchmark of the list. The dark mark is the row's benchmark (its 6-month average);
 * once the month passes it, a ⚠ (labelled for screen readers) sits after the name. `limit` cuts
 * the list with "+ N more", or with `onMore` a button "Show the other N" (never "more" in a
 * button's name: the frame's menu is "More"); with `onSelect`, each row is a button.
 * Without rows, a sentence (the page's own with `emptyText`).
 *
 * Loading: `BreakdownSkeleton`, as many rows as the block shows, same heights.
 *
 * Motion: when the month changes, each bar grows or shrinks to its new length and its mark
 * slides, in 200 ms (ease-out), and the amounts roll; a row's background fades in 150 ms on
 * hover. Cut under reduced motion.
 *
 * Don't: sort it other than by amount, mix spending and income in one list, or show more than a
 * screen of rows without a limit.
 */
const meta = {
  title: "Money/Breakdown",
  component: Breakdown,
  args: { rows: october },
} satisfies Meta<typeof Breakdown>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Five rows and "Show the other 3", each row clickable. */
export const Default: Story = { render: () => <Choosing limit={5} /> };

/** Every row, nothing to click. */
export const ReadOnly: Story = {};

/** Merchants: no benchmark, so no mark. */
export const Merchants: Story = {
  args: {
    rows: MERCHANTS.map((merchant) => ({
      id: merchant.id,
      name: merchant.name,
      icon: "merchant",
      amount: merchant.spent,
    })),
  },
};

/** Nothing spent: the sentence. */
export const Empty: Story = { args: { rows: [] } };

/** The page's own sentence when empty. */
export const EmptyWithText: Story = {
  args: { rows: [], emptyText: "No subject this month. Tag a line to follow a project." },
};

/** The month changes: the bars grow to their new lengths. */
export const ChangingMonth: Story = { render: () => <SwitchingMonths /> };

/** On a French page (`<html lang="fr">`): amounts and words in French. */
export const French: Story = {
  args: { limit: 5 },
  render: (args) => (
    <InFrench>
      <Breakdown {...args} />
    </InFrench>
  ),
};

/** Loading: five rows and the "+ N more" line, shaped like `Default`. */
export const Loading: Story = { render: () => <BreakdownSkeleton rows={5} more /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Choosing limit={5} />,
};
