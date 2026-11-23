import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { AccountLines, AccountLinesSkeleton } from "./account-lines";
import type { AccountLineRow } from "./account-lines";

const eur = (minor: number) => ({ minor, currency: "EUR" });

const ROWS: ReadonlyArray<AccountLineRow> = [
  {
    id: "1",
    day: "31 Oct.",
    label: "Wavely Mobile",
    amount: eur(-1600),
    balanceAfter: eur(186_000),
  },
  {
    id: "2",
    day: "30 Oct.",
    label: "Greenmarket",
    tag: "+ €28 MealCard",
    amount: eur(-5200),
    balanceAfter: eur(187_600),
  },
  {
    id: "3",
    day: "28 Oct.",
    label: "→ Northbank PEA",
    tag: "Transfer",
    muted: true,
    amount: eur(-35_000),
    balanceAfter: eur(192_800),
  },
  {
    id: "4",
    day: "27 Oct.",
    label: "Corner Pharmacy",
    tag: "refunded €8",
    amount: eur(-1960),
    balanceAfter: eur(227_800),
  },
];

/**
 * An account's lines (docs/wireframes, screen 7, block 5): day, label, amount and the balance once
 * the line is counted, newest first. A transfer is greyed, as the operations screen shows it.
 * `onShowOlder` adds a button; without it, every line is already shown.
 *
 * Loading: `AccountLinesSkeleton`, the same number of rows.
 */
const meta = {
  title: "Accounts/AccountLines",
  component: AccountLines,
  args: { rows: ROWS },
} satisfies Meta<typeof AccountLines>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithShowOlder: Story = { args: { onShowOlder: () => undefined } };

/** A balance-mode account with nothing entered yet. */
export const Empty: Story = { args: { rows: [] } };

export const EmptyWithText: Story = {
  args: { rows: [], emptyText: "Nothing noted yet: add this month's balance." },
};

export const Loading: Story = { render: () => <AccountLinesSkeleton /> };

export const French: Story = {
  render: (args) => (
    <InFrench>
      <AccountLines {...args} />
    </InFrench>
  ),
};

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
