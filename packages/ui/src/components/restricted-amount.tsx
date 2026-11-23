import type { Money } from "../lib/money";
import { Amount } from "./amount";

export type RestrictedAmountProps = {
  value: Money;
  /** `sm` in rows and totals, `lg` for a block's headline figure. */
  size: "sm" | "lg";
  /** Whole units (`€452`); by default for `lg`, a total's way. */
  whole?: boolean;
  /** The page's language (`<html lang>`) unless given. */
  locale?: string;
  /** The digits roll to the next value when it changes (`Amount`'s `roll`). */
  roll?: boolean;
};

/**
 * Restricted money: an amount on a hatched chip (docs/design.md, "Hatching for money apart"), for
 * benefit accounts' balances and credits. It reads as "yours, but not the same" without a colour
 * of its own.
 *
 * Motion: none of its own; with `roll`, the digits roll as `Amount`'s do (200 ms, cut under
 * reduced motion).
 */
export function RestrictedAmount({
  value,
  size,
  whole = size === "lg",
  locale,
  roll = false,
}: RestrictedAmountProps) {
  return (
    <span
      data-slot="restricted-amount"
      className="inline-flex items-center rounded-md bg-hatched-restricted px-1.5 py-0.5"
    >
      <Amount value={value} size={size} whole={whole} locale={locale} roll={roll} />
    </span>
  );
}
