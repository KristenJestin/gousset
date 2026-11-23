import { Result } from "effect";

import { shiftDay } from "../transfers/pairing";
import { MAX_SHARES } from "../values";

export { MAX_SHARES } from "../values";

// An expense made of parts of lines (#27; docs/vision.md, "An expense is not a bank line"): the
// rules alone, on values already read, so that the line's detail, linking, splitting and the
// refunds proposed all decide alike. An income is made the same way: its payments come in, its
// refunds go out.

/** A part of a line: a payment moves money the entry's way, a refund back. */
export type PartRole = "payment" | "refund";

export type EntryKind = "expense" | "income";

/** How many days after a purchase a line coming back may be its cancellation, proposed as a refund. */
export const REFUND_DAYS = 60;

/** How many expenses a line coming back is proposed as the refund of, at most. */
export const PROPOSALS_SHOWN = 3;

/** A merchant's cleaned label shorter than this, letters and digits only, names no one alone. */
const MIN_KEY = 4;

/**
 * What an entry costs (an expense) or brings (an income): its payments less its refunds, positive
 * the entry's way. Counted once, whatever the accounts its payments came from.
 */
export function netOf(
  parts: ReadonlyArray<{ readonly role: PartRole; readonly amountMinor: number }>,
): number {
  return parts.reduce(
    (net, part) => net + (part.role === "payment" ? part.amountMinor : -part.amountMinor),
    0,
  );
}

/** The role a line of this signed amount plays in an entry of this kind. */
export function roleOf(kind: EntryKind, amountMinor: number): PartRole {
  return amountMinor < 0 === (kind === "expense") ? "payment" : "refund";
}

/** Beyond 11 digits of units, an amount in minor units of four digits would pass 2⁵³. */
const DECIMAL = /^(\d{1,11})(?:[.,](\d+))?$/;

/**
 * A positive amount typed in major units ("12.50", "12,5", "40") in minor units of a currency of
 * `digits` decimals; undefined for anything else: a sign, more decimals than the currency has, no
 * number at all, or nothing.
 */
export function minorOfDecimal(text: string, digits: number): number | undefined {
  const match = DECIMAL.exec(text.trim());

  if (match === null) {
    return undefined;
  }

  const fraction = match[2] ?? "";

  if (fraction.length > digits) {
    return undefined;
  }

  return Number(`${match[1] ?? "0"}${fraction.padEnd(digits, "0")}`);
}

/** Why a line's shares cannot split it: `index` names the share whose amount is wrong. */
export type ShareRefusal =
  | { readonly reason: "count" }
  | { readonly reason: "sum" }
  | { readonly reason: "amount"; readonly index: number };

/**
 * The shares of a line of `amountMinor`, typed in major units of a currency of `digits` decimals:
 * one to `MAX_SHARES`, each a positive amount, together the line's whole amount. A split line sums
 * to the line.
 */
export function sharesOf(
  amountMinor: number,
  digits: number,
  amounts: ReadonlyArray<string>,
): Result.Result<ReadonlyArray<number>, ShareRefusal> {
  if (amounts.length === 0 || amounts.length > MAX_SHARES) {
    return Result.fail({ reason: "count" });
  }

  const shares: Array<number> = [];

  for (const [index, text] of amounts.entries()) {
    const minor = minorOfDecimal(text, digits);

    if (minor === undefined || minor === 0) {
      return Result.fail({ reason: "amount", index });
    }

    shares.push(minor);
  }

  const total = shares.reduce((sum, share) => sum + share, 0);

  return total === Math.abs(amountMinor) ? Result.succeed(shares) : Result.fail({ reason: "sum" });
}

/**
 * A counted line, as a refund proposal reads it: its merchant (by its alias), the cleaned label
 * that names it, and the net of the one entry it pays (none for the line coming back).
 */
export type ProposalLine = {
  readonly id: string;
  readonly currency: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
  readonly merchantId: string | null;
  /** The cleaned label (`merchantKey`); null when the label names no one. */
  readonly key: string | null;
  /** Its entry's net, positive the entry's way. */
  readonly netMinor: number;
};

const compactOf = (key: string) => key.replaceAll(/[^A-Z\d]/g, "");

/**
 * Whether two lines are the same merchant's: the same merchant by their aliases, or a cleaned label
 * that holds the other's ("AVOIR CORNER BISTRO" and "CORNER BISTRO"), letters and digits only.
 */
function sameMerchant(a: ProposalLine, b: ProposalLine): boolean {
  if (a.merchantId !== null && a.merchantId === b.merchantId) {
    return true;
  }

  if (a.key === null || b.key === null) {
    return false;
  }

  const [shorter, longer] = [compactOf(a.key), compactOf(b.key)].toSorted(
    (x, y) => x.length - y.length,
  );

  return (
    shorter !== undefined &&
    longer !== undefined &&
    shorter.length >= MIN_KEY &&
    longer.includes(shorter)
  );
}

/**
 * The expenses a line coming back may cancel, all or part (a purchase cancelled, an order returned),
 * for the user to confirm as a refund, never applied unasked: lines of the opposite sign, of the
 * same merchant and currency, booked on the same day or up to `REFUND_DAYS` before, of an amount and
 * a net at least the line's. The exact amount first, then the nearest day; `PROPOSALS_SHOWN` at most.
 */
export function refundProposals(
  line: ProposalLine,
  candidates: ReadonlyArray<ProposalLine>,
): ReadonlyArray<ProposalLine> {
  const back = Math.abs(line.amountMinor);
  const earliest = shiftDay(line.bookedOn, -REFUND_DAYS);

  return candidates
    .filter(
      (other) =>
        other.id !== line.id &&
        back > 0 &&
        Math.sign(other.amountMinor) === -Math.sign(line.amountMinor) &&
        other.currency === line.currency &&
        other.bookedOn <= line.bookedOn &&
        other.bookedOn >= earliest &&
        Math.abs(other.amountMinor) >= back &&
        other.netMinor >= back &&
        sameMerchant(line, other),
    )
    .toSorted(
      (a, b) =>
        Number(Math.abs(b.amountMinor) === back) - Number(Math.abs(a.amountMinor) === back) ||
        b.bookedOn.localeCompare(a.bookedOn) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, PROPOSALS_SHOWN);
}
