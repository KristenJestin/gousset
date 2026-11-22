import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { AccountChip } from "./account-chip";
import type { AccountChipKind } from "./account-chip";

// The made-up accounts, each with the kind its chip shows.
const ACCOUNT_CHIPS: ReadonlyArray<{ name: string; kind: AccountChipKind }> = [
  { name: "Current account", kind: "bank" },
  { name: "Livret A", kind: "savings" },
  { name: "MealCard", kind: "card" },
  { name: "Pocket money", kind: "wallet" },
];

/**
 * An account's name with its kind's icon (`bank`, `savings`, `card`, `wallet`), small, where a
 * line says which account it went through ("Paid with: MealCard"). In a filter it may be
 * `selected`, and removable with `onRemove` (a small cross whose label names the account).
 *
 * Motion: the cross's background fades in 150 ms on hover; cut under reduced motion.
 *
 * Don't: use it as a button to open the account (that is a link), put an amount in it, or give
 * it a colour of its own.
 */
const meta = {
  title: "Data/AccountChip",
  component: AccountChip,
  args: { name: "MealCard", kind: "card" },
} satisfies Meta<typeof AccountChip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Beside a line's detail, as in the wireframes. */
export const PaidWith: Story = {
  render: (args) => (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      Paid with: <AccountChip {...args} />
    </p>
  ),
};

/** Each kind with its icon. */
export const Kinds: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {ACCOUNT_CHIPS.map((account) => (
        <AccountChip key={account.name} name={account.name} kind={account.kind} />
      ))}
    </div>
  ),
};

export const Selected: Story = { args: { selected: true } };

/** In a filter: each chosen account can be taken out. */
export const Removable: Story = {
  render: function Removable() {
    const [chosen, setChosen] = useState(ACCOUNT_CHIPS.slice(0, 3));

    return (
      <div className="flex flex-wrap gap-2">
        {chosen.map((account) => (
          <AccountChip
            key={account.name}
            name={account.name}
            kind={account.kind}
            selected
            onRemove={() => setChosen(chosen.filter((other) => other !== account))}
          />
        ))}
      </div>
    );
  },
};

/** A long name is cut, never wrapped. */
export const LongName: Story = {
  render: () => (
    <div className="w-40">
      <AccountChip name="Joint account for the holidays" kind="bank" />
    </div>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {ACCOUNT_CHIPS.map((account) => (
        <AccountChip key={account.name} name={account.name} kind={account.kind} />
      ))}
    </div>
  ),
};
