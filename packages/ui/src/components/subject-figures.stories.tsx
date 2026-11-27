import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { SubjectFigures, SubjectFiguresSkeleton } from "./subject-figures";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/**
 * A subject's figures (docs/wireframes, screen 5, block 2): its cost in the period and per month;
 * for a subject that has a value, its estimated value and its loan with what is still owed. Other
 * currencies are said apart, never converted.
 *
 * Loading: `SubjectFiguresSkeleton`, two figures or four.
 *
 * Motion: when the period changes the amounts roll to their new values in 200 ms (`Amount`), as
 * the review's do; cut under reduced motion.
 *
 * Don't: add another currency to the cost: it is said apart.
 */
const meta = {
  title: "Subjects/SubjectFigures",
  component: SubjectFigures,
  args: {
    costLabel: "cost in 2026",
    cost: eur(198_000),
    perMonth: eur(16_500),
    asset: { value: eur(1_200_000), loan: null },
  },
} satisfies Meta<typeof SubjectFigures>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The van: a value, no loan. */
export const Default: Story = {};

/** The house: a value and the loan it is bought with. */
export const WithLoan: Story = {
  args: {
    cost: eur(888_000),
    perMonth: eur(74_000),
    asset: {
      value: eur(32_000_000),
      loan: { name: "Harbor Savings loan", balance: eur(-18_450_000) },
    },
  },
};

/** A trip: no value, a part paid in another currency. */
export const Dated: Story = {
  args: {
    costLabel: "cost in 2028",
    cost: eur(124_000),
    perMonth: eur(124_000),
    asset: undefined,
    elsewhere: [{ minor: 18_000, currency: "CHF" }],
  },
};

/** Nothing spent in the period. */
export const NoExpense: Story = {
  args: { cost: eur(0), perMonth: null, asset: undefined },
};

/** The van's figures, a button switching between 2026 and all time. */
function PeriodSwitch() {
  const [all, setAll] = useState(false);

  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="secondary" onClick={() => setAll(!all)}>
        {all ? "Show 2026" : "Show all time"}
      </Button>
      <SubjectFigures
        costLabel={all ? "cost, all time" : "cost in 2026"}
        cost={eur(all ? 742_500 : 198_000)}
        perMonth={eur(all ? 15_800 : 16_500)}
        asset={{ value: eur(1_200_000), loan: null }}
      />
    </div>
  );
}

/** Changing the period: the amounts roll from one to the next. */
export const ChangingPeriod: Story = { render: () => <PeriodSwitch /> };

export const Loading: Story = { render: () => <SubjectFiguresSkeleton asset /> };

export const French: Story = {
  args: { costLabel: "coût en 2026" },
  render: (args) => (
    <InFrench>
      <SubjectFigures {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
