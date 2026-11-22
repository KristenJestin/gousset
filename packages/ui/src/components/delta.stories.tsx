import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MONTH_FIGURES } from "../stories/made-up";
import { Button } from "./button";
import { Delta } from "./delta";

const average = { minor: 193_400, currency: "EUR" };

/** Spending this month against two references: the colour follows the meaning. */
function SwitchingMonths() {
  const [current, setCurrent] = useState(true);

  return (
    <div className="flex flex-col items-start gap-4">
      <Delta
        value={current ? MONTH_FIGURES.spent : { minor: 180_000, currency: "EUR" }}
        reference={average}
        referenceLabel="your 6-month average"
      />
      <Button variant="secondary" onClick={() => setCurrent(!current)}>
        {current ? "Previous month" : "Next month"}
      </Button>
    </div>
  );
}

/**
 * A change against a reference, small and coloured: `+5%` or `−€80`, with an up or down icon.
 * The colour says whether it is good, by `meaning`: for spending, up is red and down green; for
 * income and savings, the other way round; grey when it rounds to nothing (under 0.5 %). Against
 * a reference of zero there is no percentage, so it shows the amount. Screen readers hear the
 * sentence: "5% more than your 6-month average", the reference in the page's words.
 *
 * Motion: its colour moves to the new meaning in 150 ms when the value changes; cut under reduced
 * motion.
 *
 * Don't: use it for a figure that is not compared with anything, colour it yourself, or leave
 * out `referenceLabel` (the change means nothing without what it is against).
 */
const meta = {
  title: "Money/Delta",
  component: Delta,
  args: {
    value: MONTH_FIGURES.spent,
    reference: average,
    referenceLabel: "your 6-month average",
  },
} satisfies Meta<typeof Delta>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Spending 5 % over its average: up, in red. */
export const SpendingUp: Story = {};

/** Spending under its average: down, in green. */
export const SpendingDown: Story = {
  args: { value: { minor: 180_000, currency: "EUR" } },
};

/** Income up: good, in green. */
export const IncomeUp: Story = {
  args: {
    value: MONTH_FIGURES.received,
    reference: MONTH_FIGURES.previous.received,
    referenceLabel: "last month",
    meaning: "income",
  },
};

/** Less set aside than last month: in red. */
export const SavingsDown: Story = {
  args: {
    value: { minor: 50_000, currency: "EUR" },
    reference: MONTH_FIGURES.previous.saved,
    referenceLabel: "last month",
    meaning: "savings",
  },
};

/** Nearly no change: grey, a flat mark. */
export const Steady: Story = {
  args: { value: { minor: 193_900, currency: "EUR" } },
};

/** As an amount, in whole units: `−€80`. */
export const AsAmount: Story = {
  args: {
    value: { minor: 32_000, currency: "EUR" },
    reference: { minor: 40_000, currency: "EUR" },
    show: "amount",
    whole: true,
    referenceLabel: "last month",
  },
};

/** Against nothing (a first month): no percentage, the amount instead. */
export const AgainstNothing: Story = {
  args: {
    value: { minor: 9800, currency: "EUR" },
    reference: { minor: 0, currency: "EUR" },
    referenceLabel: "last month",
  },
};

/** In French: `+5 %`. */
export const French: Story = { args: { locale: "fr", referenceLabel: "votre moyenne sur 6 mois" } };

/** The month changes: the figure and its colour follow. */
export const ChangingMonth: Story = { render: () => <SwitchingMonths /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
