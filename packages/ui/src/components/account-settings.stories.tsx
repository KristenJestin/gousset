import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { AccountSettings, AccountSettingsSkeleton } from "./account-settings";
import { Button } from "./button";

/**
 * An account's settings, read only (docs/wireframes, screen 7, block 4): its kind, tracking,
 * currency, when it was opened and its institution; a card also shows what it settles into, a
 * benefit account the order its credits are used in (`creditOrder`), an account kept by its
 * balance the category its movements go to (`balanceCategory`).
 * `action` holds the "Edit" button.
 *
 * Loading: `AccountSettingsSkeleton`, the same number of rows.
 */
const meta = {
  title: "Accounts/AccountSettings",
  component: AccountSettings,
  args: {
    kind: "Current account",
    tracking: "lines",
    currency: "EUR",
    openedOn: "14 May 2018",
    institution: "Northbank",
    action: (
      <Button variant="secondary" size="sm" icon="edit">
        Edit
      </Button>
    ),
  },
} satisfies Meta<typeof AccountSettings>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A deferred-debit card: it settles into the current account it is debited from. */
export const Card: Story = {
  args: {
    kind: "Card",
    tracking: "lines",
    openedOn: "3 Jan. 2024",
    institution: "Northbank",
    settlesInto: "Current account",
  },
};

/** A benefit account with nothing known but its tracking. */
export const Sparse: Story = {
  args: { kind: "Restricted use", tracking: "balance", openedOn: null, institution: undefined },
};

/** A benefit account: the order its credits are used in, one more row. */
export const BenefitAccount: Story = {
  args: {
    kind: "Restricted use",
    tracking: "lines",
    openedOn: "1 Sept. 2025",
    institution: "PerksHub",
    creditOrder: "Oldest first",
  },
};

/** A benefit account kept by its balance: the category each noted balance's movement goes to. */
export const KeptByBalance: Story = {
  args: {
    kind: "Benefit account",
    tracking: "balance",
    openedOn: "1 Sept. 2025",
    institution: "PerksHub",
    creditOrder: "Oldest first",
    balanceCategory: "Leisure › Sport",
  },
};

export const Loading: Story = { render: () => <AccountSettingsSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <AccountSettings {...args} />
    </InFrench>
  ),
};
