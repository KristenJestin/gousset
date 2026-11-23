import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { InvestmentList, InvestmentListSkeleton } from "./investment-list";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/**
 * The investment accounts at the end of the month (screen 1, block 4): each one's value, its gain
 * against what was put in, and that gain as a percentage, green or red. The detail lives in
 * Investments.
 *
 * Loading: `InvestmentListSkeleton`, one row by default, same height.
 *
 * Motion: when the month changes, the value rolls (200 ms, ease-out); cut under reduced motion.
 *
 * Don't: show a yearly return here; the percentage is the gain on what was put in.
 */
const meta = {
  title: "Money/Investment list",
  component: InvestmentList,
  args: {
    accounts: [
      { id: "pea", account: "Northbank PEA", value: eur(418_000), netContributions: eur(380_000) },
    ],
    label: "Investments",
    emptyText: "No investment account yet.",
  },
} satisfies Meta<typeof InvestmentList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Worth less than what was put in: the gain and its percentage in red. */
export const Loss: Story = {
  args: {
    accounts: [
      { id: "pea", account: "Northbank PEA", value: eur(360_000), netContributions: eur(380_000) },
      {
        id: "cto",
        account: "Harbour brokerage",
        value: eur(52_000),
        netContributions: eur(50_000),
      },
    ],
  },
};

export const Empty: Story = { args: { accounts: [] } };

/** On a French page (`<html lang="fr">`): amounts and percentage in French. */
export const French: Story = {
  render: (args) => (
    <InFrench>
      <InvestmentList {...args} emptyText="Aucun compte d’investissement." />
    </InFrench>
  ),
};

export const Loading: Story = { render: () => <InvestmentListSkeleton /> };

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
