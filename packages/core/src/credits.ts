import type { CreditOrder } from "./account-values";

export type { CreditOrder } from "./account-values";

/** A counted line of a benefit account, as the credits are replayed from. */
export type CountedLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly label: string;
  readonly expiresOn: string | null;
};

/** A credit of a benefit account and what is left on it. */
export type CreditLeft = {
  /** Null for the opening balance, which is no line. */
  readonly lineId: string | null;
  /** The day it was credited; null for the opening balance. */
  readonly creditedOn: string | null;
  readonly label: string | null;
  readonly amountMinor: number;
  readonly leftMinor: number;
  readonly expiresOn: string | null;
};

export type CreditsLeft = {
  /** Every credit, used up or not, in the account's order of use. */
  readonly credits: ReadonlyArray<CreditLeft>;
  /** What the outgoing lines took beyond every credit booked before them, still to be covered. */
  readonly uncoveredMinor: number;
};

/** The opening balance comes before every line; then the day credited, then the id. */
function byDayCredited(a: CreditLeft, b: CreditLeft): number {
  if (a.lineId === null || b.lineId === null) {
    return a.lineId === b.lineId ? 0 : a.lineId === null ? -1 : 1;
  }

  return (a.creditedOn ?? "").localeCompare(b.creditedOn ?? "") || a.lineId.localeCompare(b.lineId);
}

/** The soonest expiry first, credits without one after every dated one. */
function byExpiry(a: CreditLeft, b: CreditLeft): number {
  if (a.expiresOn === b.expiresOn) {
    return byDayCredited(a, b);
  }

  if (a.expiresOn === null || b.expiresOn === null) {
    return a.expiresOn === null ? 1 : -1;
  }

  return a.expiresOn.localeCompare(b.expiresOn);
}

const ORDER_OF_USE = {
  oldest_first: byDayCredited,
  expiring_first: byExpiry,
} as const satisfies { readonly [Order in CreditOrder]: (a: CreditLeft, b: CreditLeft) => number };

type Credit = { -readonly [Key in keyof CreditLeft]: CreditLeft[Key] };

/**
 * What is left on each credit of a benefit account kept by its lines (docs/data-model.md,
 * "Accounts"), computed on read, never stored.
 *
 * - The credits are the positive lines. The opening balance, when positive, is the oldest credit,
 *   with no line, no day and no expiry.
 * - `lines` are the account's counted lines booked up to today, oldest first (booked on, then id),
 *   and are replayed in that order. Each negative line (a payment, a transfer out) uses up the
 *   credits booked before it, in the account's order: `oldest_first` by the day credited (then the
 *   id, the opening balance first); `expiring_first` by expiry date, soonest first, the credits
 *   without one after every dated one, ties by the day credited then the id.
 * - A payment larger than what is left takes the rest from the next credits as they come: until
 *   then it is uncovered. A negative opening balance starts as uncovered.
 * - An expiry date never skips a credit: an expired credit with something left is still used.
 *   Expiry dates never move money by themselves; a line says when what expired leaves.
 *
 * Returns every credit, in order of use, and what is uncovered.
 */
export function creditsLeft(
  openingMinor: number,
  lines: ReadonlyArray<CountedLine>,
  order: CreditOrder,
): CreditsLeft {
  const credits: Array<Credit> = [];
  const compare = ORDER_OF_USE[order];
  let uncoveredMinor = Math.max(-openingMinor, 0);

  if (openingMinor > 0) {
    credits.push({
      lineId: null,
      creditedOn: null,
      label: null,
      amountMinor: openingMinor,
      leftMinor: openingMinor,
      expiresOn: null,
    });
  }

  for (const line of lines) {
    if (line.amountMinor > 0) {
      const covered = Math.min(uncoveredMinor, line.amountMinor);

      uncoveredMinor -= covered;
      credits.push({
        lineId: line.id,
        creditedOn: line.bookedOn,
        label: line.label,
        amountMinor: line.amountMinor,
        leftMinor: line.amountMinor - covered,
        expiresOn: line.expiresOn,
      });
    } else if (line.amountMinor < 0) {
      let wanted = -line.amountMinor;

      for (const credit of credits.toSorted(compare)) {
        if (wanted === 0) {
          break;
        }

        const taken = Math.min(credit.leftMinor, wanted);

        credit.leftMinor -= taken;
        wanted -= taken;
      }

      uncoveredMinor += wanted;
    }
  }

  return { credits: credits.toSorted(compare), uncoveredMinor };
}

/** What expires when: what is left on the credits with an expiry, summed by day, soonest first. */
export function expiringOf(
  credits: ReadonlyArray<CreditLeft>,
): ReadonlyArray<{ readonly day: string; readonly minor: number }> {
  const byDay = new Map<string, number>();

  for (const credit of credits) {
    if (credit.expiresOn !== null && credit.leftMinor > 0) {
      byDay.set(credit.expiresOn, (byDay.get(credit.expiresOn) ?? 0) + credit.leftMinor);
    }
  }

  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, minor]) => ({ day, minor }));
}
