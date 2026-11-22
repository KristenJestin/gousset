import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MONTH_FIGURES, OVERSPENT_FIGURES } from "../stories/made-up";
import { Button } from "./button";
import { Delta } from "./delta";
import { MonthBar, MonthBarSkeleton } from "./month-bar";
import type { MoneyRole } from "./month-bar";

const average = { minor: 193_400, currency: "EUR" };

const october = {
  received: MONTH_FIGURES.received,
  spent: MONTH_FIGURES.spent,
  saved: MONTH_FIGURES.saved,
  left: MONTH_FIGURES.left,
};

const september = MONTH_FIGURES.previous;

/** The bar, with what a click chose written under it. */
function Choosing() {
  const [chosen, setChosen] = useState<MoneyRole | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <MonthBar
        {...october}
        note="salary and meal vouchers"
        comparison={
          <Delta value={october.spent} reference={average} referenceLabel="your 6-month average" />
        }
        onSelect={setChosen}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        {chosen === null ? "Nothing chosen" : `Chosen: ${chosen}`}
      </p>
    </div>
  );
}

/** Switches between this month and the one before: the parts grow, the amounts roll. */
function SwitchingMonths() {
  const [current, setCurrent] = useState(true);
  const figures = current ? october : september;

  return (
    <div className="flex flex-col items-start gap-4">
      <div className="w-full">
        <MonthBar {...figures} note="salary and meal vouchers" onSelect={() => undefined} />
      </div>
      <Button variant="secondary" onClick={() => setCurrent(!current)}>
        {current ? "Previous month" : "Next month"}
      </Button>
    </div>
  );
}

/**
 * The month in one bar (screen 1, block 1): the money received, cut into spent, set aside and
 * left, each in its role's colour (`--money-spent`, `--money-saved`, `--money-left`), with each
 * part's amount under it and the total above. With `onSelect`, each part is a button (Tab, Enter)
 * that opens the operations behind it. When more went out than came in, the bar stretches to
 * what went out, a dark mark shows where the money received ended, and the last part says by how
 * much the month is overspent, in red.
 *
 * Loading: `MonthBarSkeleton`, the same three lines at the same heights.
 *
 * Motion: when the month changes, the parts grow or shrink to their new widths in 200 ms
 * (ease-out) and the amounts roll; cut under reduced motion. Widths are SVG attributes, so the
 * server's markup draws the bar with no style attribute.
 *
 * Don't: put it in a block inside a block, add a fourth part, or reorder the parts (they read in
 * the order money goes).
 */
const meta = {
  title: "Money/Month bar",
  component: MonthBar,
  args: october,
} satisfies Meta<typeof MonthBar>;

export default meta;

type Story = StoryObj<typeof meta>;

/** With its note, its comparison and clickable parts. */
export const Default: Story = { render: () => <Choosing /> };

/** Without `onSelect`: nothing to click. */
export const ReadOnly: Story = { args: { note: "salary and meal vouchers" } };

/** More went out than came in. */
export const Overspent: Story = {
  args: { ...OVERSPENT_FIGURES, note: "salary and meal vouchers", onSelect: () => undefined },
};

/** A month with nothing yet: an empty bar, zeros. */
export const Empty: Story = {
  args: {
    received: { minor: 0, currency: "EUR" },
    spent: { minor: 0, currency: "EUR" },
    saved: { minor: 0, currency: "EUR" },
    left: { minor: 0, currency: "EUR" },
  },
};

/** The month changes: the parts grow to their new widths. */
export const ChangingMonth: Story = { render: () => <SwitchingMonths /> };

/** In French. */
export const French: Story = { args: { locale: "fr", note: "salaire et titres-restaurant" } };

/** Loading: the skeleton, shaped like the bar. */
export const Loading: Story = { render: () => <MonthBarSkeleton /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Choosing />,
};
