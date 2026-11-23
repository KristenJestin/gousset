import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { CategoryPicker } from "./category-picker";
import { LineDetail, LineDetailSkeleton } from "./line-detail";
import { LineTransfer } from "./line-transfer";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** The column the page gives the detail: 340 px beside the list. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex h-150 w-85 max-w-full">{children}</div>;
}

/**
 * One line's detail (screen 2, block 3): its label and amount, its account, the day it was booked
 * and its value date, the bank's raw label (fixed-width) with its memo and counterparty, the
 * original amount of a line in another currency, its expiry, "To review: looks like …" on a held
 * line, and the import it came from or "Entered by hand"; first, a counted line's category, through
 * the control the page gives (`category`, a `CategoryPicker`). Every value comes worded from the
 * page; the close button or Escape closes it.
 *
 * Loading: `LineDetailSkeleton`, its title, amount and rows at the same heights.
 *
 * Motion: opened from `OperationsList`, it grows out of its row (a shared layout, 300 ms,
 * ease-out), its content fading in after 100 ms, and folds back into the row on close (see
 * `OperationsLayout`). Drawn by the server, it stays still. Cut under reduced motion.
 *
 * Don't: show it without its row's id (the shared layout pairs them), or edit the line's own
 * figures in it: the bank's are read only; only its category is chosen.
 */
const meta = {
  title: "Operations/LineDetail",
  component: LineDetail,
  args: {
    id: "line-0",
    label: "CB GREENMARKET 2110 RIVERTON",
    amount: eur(-5200),
    account: "Current account",
    bookedOn: "21 October 2026",
    valueOn: "22 October 2026",
    rawLabel: "CB GREENMARKET 2110 RIVERTON CARTE 4971",
    memo: "Weekly shop",
    counterparty: "Greenmarket Riverton",
    importedFrom: {
      fileName: "current-account-2026-10.csv",
      importedOn: "24 October 2026",
      period: "1–23 October 2026",
    },
    onClose: () => undefined,
  },
  render: (args) => (
    <Column>
      <LineDetail {...args} />
    </Column>
  ),
} satisfies Meta<typeof LineDetail>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A line from an imported statement. */
export const Imported: Story = {};

/** A counted line: its category first, chosen with a `CategoryPicker`. */
export const WithCategory: Story = {
  args: {
    category: (
      <CategoryPicker
        label="Category"
        placeholder="Search a category"
        size="sm"
        categories={[
          {
            id: "groceries",
            name: "Groceries",
            children: [{ id: "supermarket", name: "Supermarket" }],
          },
          { id: "other", name: "Other" },
        ]}
        value="supermarket"
        onValueChange={() => undefined}
      />
    ),
  },
};

/** A line held for review: the line it looks like comes first. */
export const ToReview: Story = {
  args: { looksLike: "21 Oct., MEALCARD GREENMARKET RIVERTON, −€28.00" },
};

/** Paid in another currency: the amount as the account counts it, and the original one. */
export const OtherCurrency: Story = {
  args: {
    label: "CB HARBOUR BOOKS LONDON",
    rawLabel: "CB HARBOUR BOOKS LONDON GBP 18,40",
    amount: eur(-2134),
    originalAmount: { minor: -1840, currency: "GBP" },
    memo: undefined,
    counterparty: undefined,
  },
};

/** A meal card's credit, which expires. */
export const Expiring: Story = {
  args: {
    label: "MEALCARD CREDIT OCTOBER",
    rawLabel: "MEALCARD CREDIT OCTOBER",
    account: "MealCard",
    amount: eur(18_000),
    expiresOn: "31 December 2027",
    memo: undefined,
    counterparty: undefined,
  },
};

/** A side of a transfer: its other side, one click away (`LineTransfer`). */
export const Transfer: Story = {
  args: {
    label: "SEPA TRF TO LIVRET A",
    rawLabel: "SEPA TRF TO LIVRET A REF 2026-10",
    amount: eur(-25_000),
    memo: undefined,
    counterparty: undefined,
    transfer: (
      <LineTransfer
        direction="out"
        other={{
          id: "line-1",
          day: "Oct 10",
          label: "SEPA TRF TO LIVRET A",
          account: "Livret A",
          amount: eur(25_000),
        }}
        setAside
        onOpenOther={() => undefined}
        onUnpair={() => Promise.resolve()}
      />
    ),
  },
};

/** Entered by hand: no import, no value date. */
export const ByHand: Story = {
  args: { importedFrom: undefined, valueOn: undefined, memo: undefined, counterparty: undefined },
};

export const Loading: Story = {
  render: () => (
    <Column>
      <LineDetailSkeleton />
    </Column>
  ),
};

export const French: Story = {
  args: { looksLike: "21 oct., MEALCARD GREENMARKET RIVERTON, −28,00 €" },
  render: (args) => (
    <InFrench>
      <Column>
        <LineDetail {...args} />
      </Column>
    </InFrench>
  ),
};

/** On a phone it takes the screen's width, over the list. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: (args) => (
    <div className="flex h-150">
      <LineDetail {...args} />
    </div>
  ),
};
