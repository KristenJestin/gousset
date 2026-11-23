import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { BenefitCredits, BenefitCreditsSkeleton } from "./benefit-credits";
import type { BenefitCredit, BenefitExpiring } from "./benefit-credits";
import { Button } from "./button";

const eur = (minor: number) => ({ minor, currency: "EUR" });

const EXPIRING: ReadonlyArray<BenefitExpiring> = [
  { day: "31 Oct.", amount: eur(12_000), expired: true },
  { day: "28 Feb. 2027", amount: eur(20_000), expired: false },
];

const CREDITS: ReadonlyArray<BenefitCredit> = [
  {
    id: "opening",
    day: null,
    label: "Balance when the account was added",
    amount: eur(5000),
    left: eur(1240),
    expires: null,
    expired: false,
  },
  {
    id: "credit-sept",
    day: "3 Sept.",
    label: "MEALCARD CREDIT",
    amount: eur(20_000),
    left: eur(12_000),
    expires: "31 Oct.",
    expired: true,
  },
  {
    id: "credit-oct",
    day: "2 Oct.",
    label: "MEALCARD CREDIT",
    amount: eur(20_000),
    left: eur(20_000),
    expires: "28 Feb. 2027",
    expired: false,
  },
];

/** The credits, with what was chosen written under them. */
function Editing() {
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <BenefitCredits
        order="Oldest first"
        expiring={EXPIRING}
        credits={CREDITS}
        onEditExpiry={setChosen}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        {chosen === null ? "Nothing chosen" : `Chosen: ${chosen}`}
      </p>
    </div>
  );
}

/** A purchase uses the September credit up: its bar shrinks to its new width. */
function Spending() {
  const [spent, setSpent] = useState(false);

  const credits = CREDITS.map((credit) =>
    spent && credit.id === "credit-sept" ? { ...credit, left: eur(2000) } : credit,
  );

  return (
    <div className="flex max-w-2xl flex-col items-start gap-4">
      <div className="w-full">
        <BenefitCredits order="Oldest first" expiring={EXPIRING} credits={credits} />
      </div>
      <Button variant="secondary" onClick={() => setSpent(!spent)}>
        {spent ? "Undo the purchase" : "Spend €100"}
      </Button>
    </div>
  );
}

/**
 * A benefit account's credits (docs/vision.md, "Benefit accounts"): the order the issuer uses
 * them in, what expires when (hatched; an expired amount is still counted until the issuer takes
 * it back), then each credit with something left, in order of use, with its expiry as a chip, what
 * is left of it and a thin hatched bar of left over credited. `onEditExpiry` adds an "Expiry date"
 * button to each credit but the opening balance (`day: null`); `uncovered` warns of spending
 * beyond the credits. Every word about the data comes from the page.
 *
 * Loading: `BenefitCreditsSkeleton`, the same lines at the same heights.
 *
 * Motion: rows fade and slide up on first paint (200 ms, staggered); when what is left of a credit
 * changes, its bar grows or shrinks to its new width in 200 ms (ease-out). Cut under reduced
 * motion. Widths are SVG attributes, so the server's markup carries no style attribute.
 *
 * Don't: colour restricted money with a `--money-*` role; it is hatched.
 */
const meta = {
  title: "Accounts/BenefitCredits",
  component: BenefitCredits,
  args: { order: "Oldest first", expiring: EXPIRING, credits: CREDITS },
} satisfies Meta<typeof BenefitCredits>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The opening balance, a credit expired with something left, and one that expires later. */
export const Default: Story = { render: () => <Editing /> };

/** Without `onEditExpiry`: nothing to click. */
export const ReadOnly: Story = {};

/** The issuer's own order. */
export const SoonestExpiryFirst: Story = {
  args: { order: "Soonest expiry first, as the issuer does" },
};

/** Spending went beyond the credits: a warning line. */
export const Uncovered: Story = { args: { uncovered: eur(3550) } };

/** Nothing left on any credit. */
export const Empty: Story = { args: { expiring: [], credits: [] } };

/** A purchase shrinks a credit: its bar moves to its new width. */
export const SpendingACredit: Story = { render: () => <Spending /> };

export const Loading: Story = { render: () => <BenefitCreditsSkeleton expiring={2} credits={3} /> };

/** On a French page (`<html lang="fr">`): amounts and words in French. */
export const French: Story = {
  args: {
    order: "Les plus anciens d'abord",
    credits: CREDITS.map((credit) =>
      credit.day === null ? { ...credit, label: "Solde à l'ajout du compte" } : credit,
    ),
    uncovered: eur(3550),
    onEditExpiry: () => undefined,
  },
  render: (args) => (
    <InFrench>
      <BenefitCredits {...args} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Editing />,
};
