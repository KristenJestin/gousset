import type { DayBalance } from "./balances";

// An account kept by its balance (#31; docs/data-model.md, v0.3, "Balance mode"): every noted
// balance makes one line, the month's movement, which becomes one expense or income. This is its
// arithmetic; writing the lines and their entries is `./balance-lines`.

/** A line of the account that is no movement: a known transfer's side, or a line entered by hand. */
export type OtherLine = { readonly bookedOn: string; readonly amountMinor: number };

/**
 * The movement each noted balance makes, oldest first: the noted balance less the one before it
 * (the opening balance before the first), less the other lines booked after that one's day and up
 * to its own, both ends as balances are, at the end of their day. So the opening balance, the other
 * lines and the movements add up, at each noted day, to the balance noted. `noted` is oldest first,
 * one a day.
 */
export function balanceMovements(
  openingMinor: number,
  noted: ReadonlyArray<DayBalance>,
  others: ReadonlyArray<OtherLine>,
): ReadonlyArray<DayBalance> {
  const sorted = others.toSorted((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  const movements: Array<DayBalance> = [];
  let previous = openingMinor;
  let next = 0;

  for (const balance of noted) {
    let between = 0;

    for (; next < sorted.length && (sorted[next]?.bookedOn ?? "") <= balance.day; next += 1) {
      between += sorted[next]?.amountMinor ?? 0;
    }

    movements.push({ day: balance.day, minor: balance.minor - previous - between });
    previous = balance.minor;
  }

  return movements;
}
