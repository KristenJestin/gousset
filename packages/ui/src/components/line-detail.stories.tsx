import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { CategoryPicker } from "./category-picker";
import { LineDetail, LineDetailSkeleton } from "./line-detail";
import { LineMerchant } from "./line-merchant";
import { LineTransfer } from "./line-transfer";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/**
 * One line's detail (screen 2, block 3): its label and amount, its account, the day it was booked
 * and its value date, the bank's raw label (fixed-width) with its memo and counterparty, the
 * original amount of a line in another currency, its expiry, "To review: looks like …" on a held
 * line, and the import it came from, "Entered by hand" or where the app made it from (`origin`);
 * first, a counted line's category, through
 * the control the page gives (`category`, a `CategoryPicker`), and who it paid (`merchant`, a
 * `LineMerchant`). Every value comes worded from the
 * page; the close button or Escape closes it.
 *
 * Loading: `LineDetailSkeleton`, its title, amount and rows at the same heights, in its sheet.
 *
 * On every screen it is the shared side `Sheet` over the page (#182): from the right edge from
 * Tailwind's `md` on, from the bottom on a phone. `OperationsLayout` holds it in its own sheet,
 * kept open from one line to the next.
 *
 * Motion: the sheet slides in from its edge in 300 ms and back out in 200 ms. A detail that came
 * with the page shows at once. Cut under reduced motion.
 *
 * Don't: open it as a column beside a list, or in a panel of the page's own; or edit the line's
 * own figures in it: the bank's are read only; only its category and merchant are chosen.
 */
const meta = {
  title: "Operations/LineDetail",
  component: LineDetail,
  args: {
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

const categories = [
  { id: "leisure", name: "Leisure", children: [{ id: "games", name: "Games" }] },
  { id: "other", name: "Other" },
];

/**
 * Paid through PayPal, its merchant not known yet: under its category, the merchant row asks who
 * was really paid (`LineMerchant`).
 */
export const WithMerchant: Story = {
  args: {
    label: "CB PAYPAL *PIXELPLAY 21/10",
    rawLabel: "CB PAYPAL *PIXELPLAY 21/10 CARTE 4971",
    amount: eur(-1499),
    memo: undefined,
    counterparty: undefined,
    category: (
      <CategoryPicker
        label="Category"
        placeholder="Search a category"
        size="sm"
        categories={categories}
        value="games"
        onValueChange={() => undefined}
      />
    ),
    merchant: (
      <LineMerchant
        merchant={null}
        intermediary="PayPal"
        asks
        merchants={["Greenmarket", "Pixelplay", "Streamly"]}
        onAssign={() => Promise.resolve(true)}
      />
    ),
  },
};

/** Its merchant assigned by hand: "Pixelplay, through PayPal", which can be changed. */
export const WithAssignedMerchant: Story = {
  args: {
    ...WithMerchant.args,
    merchant: (
      <LineMerchant
        merchant="Pixelplay"
        intermediary="PayPal"
        asks={false}
        merchants={["Greenmarket", "Pixelplay", "Streamly"]}
        onAssign={() => Promise.resolve(true)}
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

/**
 * The movement a noted balance makes on an account kept by its balance: named by the page, with no
 * raw label, and made from the balance rather than entered by hand.
 */
export const BalanceMovement: Story = {
  args: {
    label: "Balance movement",
    rawLabel: "",
    account: "PerksHub",
    amount: eur(-9000),
    bookedOn: "31 October 2026",
    valueOn: undefined,
    memo: undefined,
    counterparty: undefined,
    importedFrom: undefined,
    origin: "Made from a noted balance",
  },
};

export const Loading: Story = {
  render: () => <LineDetailSkeleton onClose={() => undefined} />,
};

export const French: Story = {
  args: { looksLike: "21 oct., MEALCARD GREENMARKET RIVERTON, −28,00 €" },
  render: (args) => (
    <InFrench>
      <LineDetail {...args} />
    </InFrench>
  ),
};

/** On a phone it is a sheet rising from the bottom edge, its label and amount at its top. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
