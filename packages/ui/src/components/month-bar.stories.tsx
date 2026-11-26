import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { MONTH_FIGURES, OVERSPENT_FIGURES } from "../stories/made-up";
import { Button } from "./button";
import { Block } from "./data-block";
import { DeltaList } from "./delta";
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

/** What the review compares the month's spending with: its average and the month before. */
const comparison = (
  <DeltaList
    lead="spending"
    items={[
      {
        id: "average",
        label: "vs. average",
        value: october.spent,
        reference: average,
        referenceLabel: "your 6-month average",
      },
      {
        id: "previous",
        label: "vs. September",
        value: october.spent,
        reference: september.spent,
        referenceLabel: "September",
      },
    ]}
  />
);

/** The bar, with what a click chose written under it. */
function Choosing() {
  const [chosen, setChosen] = useState<MoneyRole | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <MonthBar
        {...october}
        note="salary and meal vouchers"
        comparison={comparison}
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
 * left, each in its role's colour (`--money-spent`, `--money-saved`, `--money-left`), the total
 * above and a legend under it: each part's dot, amount and name, side by side from the bar's
 * start, so that a narrow part still has its key. On a phone (below 768 px, screen 11) the width
 * does not allow it: the keys are a list under the bar, one row each, the name whole and the amount
 * at the row's end, and the comparison has lines of its own under the total, each change with what it
 * is held against (a bare "+5%" under the money received would read as more income). With
 * `onSelect`, each key is a button (Tab,
 * Enter) that opens the operations behind it. When more went out than came in, the bar stretches to
 * what went out, a dark mark shows where the money received ended, and the last part says by how
 * much the month is overspent, in red. Money back that may be a refund, not answered yet (#208),
 * is no income: a quiet line under the total says how much waits so, and how many lines.
 *
 * Loading: `MonthBarSkeleton`, the same lines at the same heights, the phone's rows on a phone.
 * It holds the comparison's lines a month has from the user's second on, both of them on a phone:
 * a first month, with none, is that much shorter once loaded.
 *
 * Motion: when the month changes, the parts grow or shrink to their new widths in 200 ms
 * (ease-out) and the amounts roll; cut under reduced motion. Widths are SVG attributes, so the
 * server's markup draws the bar with no style attribute. The maybe-refunds line has no motion of
 * its own: it comes, changes and goes with the month, at once.
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

/**
 * A sliver set aside, and most of what is left on the meal voucher card (hatched): the legend
 * keeps its keys side by side from the bar's start (a list on a phone), never squeezed under a part
 * too narrow for them.
 */
export const NarrowPart: Story = {
  args: {
    received: { minor: 312_000, currency: "EUR" },
    spent: { minor: 288_000, currency: "EUR" },
    saved: { minor: 4000, currency: "EUR" },
    left: { minor: 20_000, currency: "EUR" },
    restricted: { minor: 15_300, currency: "EUR" },
    note: "salary and meal vouchers",
    onSelect: () => undefined,
  },
};

/**
 * A purchase's money back that may be a refund (#208), not answered: left out of what was received,
 * said apart under it.
 */
export const MaybeRefunds: Story = {
  args: {
    note: "salary and meal vouchers",
    maybeRefunds: { count: 1, amount: { minor: 3000, currency: "EUR" } },
    onSelect: () => undefined,
  },
};

/** Several lines waiting, in French. */
export const MaybeRefundsFrench: Story = {
  args: {
    note: "salaire et titres-restaurant",
    maybeRefunds: { count: 2, amount: { minor: 7450, currency: "EUR" } },
  },
  render: (args) => (
    <InFrench>
      <MonthBar {...args} />
    </InFrench>
  ),
};

/** More went out than came in. */
export const Overspent: Story = {
  args: { ...OVERSPENT_FIGURES, note: "salary and meal vouchers", onSelect: () => undefined },
};

/**
 * Money taken back from savings: set aside is less than nothing. More was spent than received, yet
 * money is left, so the month is not overspent: the bar stretches past the money received with no
 * mark, draws no part for the savings, and their key reads "€500 taken from savings".
 */
export const TakenFromSavings: Story = {
  args: {
    received: { minor: 200_000, currency: "EUR" },
    spent: { minor: 230_000, currency: "EUR" },
    saved: { minor: -50_000, currency: "EUR" },
    left: { minor: 20_000, currency: "EUR" },
    note: "salary",
  },
};

/** The month in another currency, apart and never converted: a quiet line under the legend. */
export const OtherCurrencies: Story = {
  args: {
    note: "salary and meal vouchers",
    notes: ["In USD: received $0, spent $25, set aside $0, left −$25"],
  },
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

/** On a French page (`<html lang="fr">`): amounts and words in French. */
export const French: Story = {
  args: { note: "salaire et titres-restaurant" },
  render: (args) => (
    <InFrench>
      <MonthBar {...args} />
    </InFrench>
  ),
};

/** Loading: the skeleton, shaped like the bar. */
export const Loading: Story = { render: () => <MonthBarSkeleton /> };

/**
 * On the narrowest phone, in its block as the review shows it, with the part left's longest name:
 * the legend is a list, one row a part, every name whole, and the comparison under the total, one
 * line a change, each saying what it is held against; the rules between the rows plain and alike.
 */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <Block title="The month">
      <MonthBar
        {...october}
        restricted={{ minor: 15_300, currency: "EUR" }}
        note="salary and meal vouchers"
        comparison={comparison}
        onSelect={() => undefined}
      />
    </Block>
  ),
};
