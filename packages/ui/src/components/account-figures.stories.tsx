import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { AccountFigures, AccountFiguresSkeleton } from "./account-figures";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/**
 * An account page's header figures (docs/wireframes, screen 7, block 1): the institution and
 * group as chips, then the balance on a day, what came in and what went out over a period.
 *
 * Loading: `AccountFiguresSkeleton`, the chips' place and the three figures at the same heights.
 */
const meta = {
  title: "Accounts/AccountFigures",
  component: AccountFigures,
  args: {
    balanceDay: "31 Oct.",
    balance: eur(186_000),
    period: "October",
    in: eur(290_000),
    out: eur(261_000),
    institution: "Northbank",
    groupLabel: "Available",
  },
} satisfies Meta<typeof AccountFigures>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A loan: a negative balance, no "in" to speak of. */
export const Loan: Story = {
  args: {
    balanceDay: "5 Oct.",
    balance: eur(-6_890_000),
    period: "October",
    in: eur(0),
    out: eur(61_000),
    institution: "Harbor Savings",
    groupLabel: "Loans",
  },
};

export const Loading: Story = { render: () => <AccountFiguresSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <AccountFigures {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
