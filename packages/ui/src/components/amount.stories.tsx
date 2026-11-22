import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MONTH_FIGURES } from "../stories/made-up";
import { Amount, AmountSkeleton, Count } from "./amount";
import { Button } from "./button";

/** A count that goes down, as the lines to review do when one is approved. */
function CountingDown() {
  const [count, setCount] = useState(6);

  return (
    <div className="flex flex-col items-start gap-4">
      <span className="text-sm">
        <Count value={count} locale="en" /> lines to review
      </span>
      <Button variant="secondary" onClick={() => setCount(Math.max(0, count - 1))}>
        Approve one
      </Button>
    </div>
  );
}

/** Switches between this month and the one before: the digits roll. */
function SwitchingMonths() {
  const [current, setCurrent] = useState(true);

  return (
    <div className="flex flex-col items-start gap-4">
      <Amount
        value={current ? MONTH_FIGURES.spent : MONTH_FIGURES.previous.spent}
        size="lg"
        whole
      />
      <Amount value={current ? MONTH_FIGURES.left : MONTH_FIGURES.previous.left} />
      <Button variant="secondary" onClick={() => setCurrent(!current)}>
        {current ? "Previous month" : "Next month"}
      </Button>
    </div>
  );
}

/**
 * An amount of money, from integer minor units and a currency: its sign (a true minus, a plus
 * when asked), the currency's own minor units (EUR 2, JPY 0, KWD 3), the locale's separators
 * (`<html lang>` unless `locale` is given) and tabular figures, so amounts line up in columns.
 * `whole` rounds to whole units for summaries (`€3,120`). `tone` gives a money role's colour,
 * only where the design gives the figure that role.
 *
 * Loading: `AmountSkeleton`, the same height at each size, inside a block's skeleton.
 *
 * Motion: when the value changes, each digit that changes rolls to its new one in 200 ms
 * (ease-out), coming in from below when the amount grows and from above when it shrinks. Cut
 * under reduced motion. No style is injected (unlike NumberFlow, which adds a `<style>` element
 * that a strict Content Security Policy blocks).
 *
 * Don't: pass a float or a number of euros (it throws on a non-integer), build the text by hand
 * with `toFixed`, colour an amount red because it is negative, or turn `roll` on in a list of
 * hundreds of lines.
 */
const meta = {
  title: "Money/Amount",
  component: Amount,
  args: { value: MONTH_FIGURES.received },
} satisfies Meta<typeof Amount>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * `Count`: a whole number that rolls like an amount (the lines to review, in a block's badge).
 * Motion: its digits roll in 200 ms, from below when it grows, from above when it drops.
 */
export const Counting: Story = { render: () => <CountingDown /> };

/** `sm` in rows, `md` in text, `lg` for a block's headline figure. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Amount value={MONTH_FIGURES.spent} size="sm" />
      <Amount value={MONTH_FIGURES.spent} size="md" />
      <Amount value={MONTH_FIGURES.spent} size="lg" />
    </div>
  ),
};

/** A negative has a true minus; a plus only when asked (a refund, a change). */
export const Signs: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Amount value={{ minor: -8000, currency: "EUR" }} />
      <Amount value={{ minor: 2650, currency: "EUR" }} sign="always" />
      <Amount value={{ minor: 0, currency: "EUR" }} sign="always" />
    </div>
  ),
};

/** Whole units in summaries, rounded half away from zero. */
export const Whole: Story = { args: { whole: true, size: "lg" } };

/** Each money role's colour, where the design gives it. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Amount value={MONTH_FIGURES.spent} tone="spent" />
      <Amount value={MONTH_FIGURES.saved} tone="saved" />
      <Amount value={MONTH_FIGURES.left} tone="left" />
      <Amount value={MONTH_FIGURES.received} tone="income" />
    </div>
  ),
};

/** Each currency with its own minor units: none for yen, three for the Kuwaiti dinar. */
export const Currencies: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Amount value={{ minor: 123_450, currency: "EUR" }} />
      <Amount value={{ minor: 123_450, currency: "JPY" }} />
      <Amount value={{ minor: 123_450, currency: "KWD" }} />
      <Amount value={{ minor: 123_450, currency: "CHF" }} />
    </div>
  ),
};

/** In French: `1 234,50 €`, with a narrow no-break space between thousands. */
export const French: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Amount value={{ minor: 123_450, currency: "EUR" }} locale="fr" />
      <Amount value={{ minor: -8000, currency: "EUR" }} locale="fr" />
      <Amount value={MONTH_FIGURES.received} locale="fr" whole size="lg" />
    </div>
  ),
};

/** The month changes: the digits roll to the new amounts. */
export const ChangingMonth: Story = { render: () => <SwitchingMonths /> };

/** Without the roll, for long static lists: plain text. */
export const WithoutRoll: Story = { args: { roll: false } };

/** Loading: each size's skeleton beside the amount it stands for. */
export const Loading: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} className="flex items-end gap-4">
          <AmountSkeleton size={size} />
          <Amount value={MONTH_FIGURES.spent} size={size} />
        </div>
      ))}
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { size: "lg", whole: true },
};
