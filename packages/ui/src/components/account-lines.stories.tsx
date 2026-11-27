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
 * `onShowOlder` adds a button; without it, every line is already shown. With `withSubjects`, what
 * each expense is for, as chips (#37), from a 576 px wide list.
 *
 * Motion: a subject's chip fades in and out in 150 ms, cut under reduced motion.
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

/** Each line's subjects, by its place: two chips at most, "+N" for the others. */
const LINE_SUBJECTS = [
  [],
  [{ id: "house", name: "House" }],
  [],
  [
    { id: "van", name: "Van" },
    { id: "alps", name: "Alps 2026" },
    { id: "dog", name: "Dog" },
  ],
];

/** What each line's expense is for: a column of subject chips (#37), none on most lines. */
export const WithSubjects: Story = {
  args: {
    withSubjects: true,
    rows: ROWS.map((row, index) => ({ ...row, subjects: LINE_SUBJECTS[index] ?? [] })),
  },
};

export const ShowOlderLoading: Story = {
  args: { onShowOlder: () => undefined, loadingOlder: true },
};

export const ShowOlderFailed: Story = {
  args: { onShowOlder: () => undefined, olderError: "Older lines could not be loaded." },
};

/** An account kept by its balance: no balance-after column, since noted balances are what it holds. */
export const BalanceMode: Story = {
  args: {
    rows: ROWS.map(({ id, day, label, amount }) => ({ id, day, label, amount })),
  },
};

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
