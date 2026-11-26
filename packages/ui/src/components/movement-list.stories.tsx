import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { MovementList, MovementListSkeleton } from "./movement-list";

const eur = (minor: number) => ({ minor, currency: "EUR" });

// Made-up movements, as packages/fixture's October 2026 has them.
const OCTOBER = [
  {
    id: "salary",
    from: "Acme Consulting",
    to: "Current account",
    note: "Salary",
    amount: eur(280_000),
  },
  {
    id: "vouchers",
    from: "Acme Consulting",
    to: "MealCard",
    note: "Meal vouchers",
    amount: eur(17_900),
  },
  { id: "livret", from: "Current account", to: "Livret A", amount: eur(25_000) },
  {
    id: "pea",
    from: "Current account",
    to: "Northbank PEA",
    amount: eur(35_000),
    bought: { name: "World index ETF", amount: eur(33_500) },
  },
];

/**
 * The month's movements between the user's own accounts, and what came in (screen 1, block 3):
 * "from → to", the account reached in bold, its amount at the end, what came in with its kind in
 * grey. A transfer to an investment account and the purchase it paid for share one row. No colour:
 * a movement is neither spending nor income.
 *
 * Loading: `MovementListSkeleton`, as many rows as the block shows, same heights.
 *
 * Money back that may be a refund (#208) is flagged "Maybe a refund": no income until answered.
 *
 * Motion: when the month changes, the amounts roll (200 ms, ease-out); cut under reduced motion.
 * The "Maybe a refund" chip has none of its own: it comes and goes with its row, at once.
 *
 * Don't: list expenses here, or colour a movement as money in or out.
 */
const meta = {
  title: "Money/Movement list",
  component: MovementList,
  args: {
    movements: OCTOBER,
    label: "Movements between your accounts",
    emptyText: "No movement this month.",
  },
} satisfies Meta<typeof MovementList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Money back that may cancel a purchase (#208), flagged: no income until the user answers. */
export const MaybeRefund: Story = {
  args: {
    movements: [
      ...OCTOBER,
      {
        id: "pixelplay",
        from: "PixelPlay",
        to: "Current account",
        amount: eur(3000),
        maybeRefund: true,
      },
    ],
  },
};

export const MaybeRefundFrench: Story = {
  args: MaybeRefund.args,
  render: (args) => (
    <InFrench>
      <MovementList {...args} emptyText="Aucun mouvement ce mois-ci." />
    </InFrench>
  ),
};

/** A month without movements: the page's sentence. */
export const Empty: Story = { args: { movements: [] } };

/** On a French page (`<html lang="fr">`): amounts in French. */
export const French: Story = {
  render: (args) => (
    <InFrench>
      <MovementList {...args} emptyText="Aucun mouvement ce mois-ci." />
    </InFrench>
  ),
};

/** Loading: four rows, shaped like `Default`. */
export const Loading: Story = { render: () => <MovementListSkeleton /> };

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
