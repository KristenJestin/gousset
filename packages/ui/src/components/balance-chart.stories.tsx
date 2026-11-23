import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { BalanceChart, BalanceChartSkeleton } from "./balance-chart";
import type { BalanceDay } from "./balance-chart";

/** A month of a current account's balance, a dip around the rent then climbing back. */
const DAYS: ReadonlyArray<BalanceDay> = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;

  return {
    date: new Date(2026, 9, day),
    balanceMinor: 236_000 - Math.max(0, 30 - day) * 1800 - (day >= 5 ? 61_000 : 0),
  };
});

/** A loan's balance over a year: negative throughout, repaid down towards zero. */
const LOAN_DAYS: ReadonlyArray<BalanceDay> = Array.from({ length: 12 }, (_, month) => ({
  date: new Date(2026, month, 1),
  balanceMinor: -7_500_000 + month * 55_000,
}));

/**
 * An account's balance day by day (docs/wireframes, screen 7, block 3): Bklit's line chart. A
 * loan's negative balance draws below zero.
 *
 * Loading: `BalanceChartSkeleton`, the chart's place at the same height.
 */
const meta = {
  title: "Accounts/BalanceChart",
  component: BalanceChart,
  args: {
    days: DAYS,
    currency: "EUR",
    label: "The current account's balance in October",
    valueLabel: "Balance",
  },
} satisfies Meta<typeof BalanceChart>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A loan: the line sits below zero throughout. */
export const Loan: Story = {
  args: { days: LOAN_DAYS, label: "The home loan's balance over 2026", valueLabel: "Balance" },
};

export const Empty: Story = { args: { days: [] } };

export const Loading: Story = { render: () => <BalanceChartSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <BalanceChart {...args} />
    </InFrench>
  ),
};

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
