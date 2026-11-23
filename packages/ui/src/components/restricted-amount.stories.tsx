import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { RestrictedAmount } from "./restricted-amount";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** Both sizes side by side: a row's or a total's figure, and a block's headline. */
function Sizes() {
  return (
    <div className="flex items-baseline gap-4">
      <RestrictedAmount value={eur(14_050)} size="sm" />
      <RestrictedAmount value={eur(45_200)} size="lg" />
    </div>
  );
}

/**
 * Restricted money (docs/design.md, "Hatching for money apart"): an amount on a hatched chip, for
 * a benefit account's balance, the "Restricted use" totals and what a credit has left. It reads as
 * "yours, but not the same" without a colour of its own.
 *
 * `sm` in rows and totals, `lg` for a block's headline; `lg` is in whole units unless `whole` says
 * otherwise.
 *
 * Motion: none of its own; with `roll`, the digits roll as `Amount`'s do (200 ms, cut under reduced
 * motion).
 *
 * Don't: colour restricted money with a `--money-*` role; it is hatched.
 */
const meta = {
  title: "Money/RestrictedAmount",
  component: RestrictedAmount,
  args: { value: eur(14_050), size: "sm" },
} satisfies Meta<typeof RestrictedAmount>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BothSizes: Story = { render: () => <Sizes /> };

/** A headline figure that keeps its cents, as an account's balance does. */
export const LargeWithCents: Story = { args: { value: eur(45_235), size: "lg", whole: false } };

/** On a French page (`<html lang="fr">`): the amount in French. */
export const French: Story = {
  render: () => (
    <InFrench>
      <Sizes />
    </InFrench>
  ),
};
