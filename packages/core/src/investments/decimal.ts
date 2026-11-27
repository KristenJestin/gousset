import { Result } from "effect";

import { InvalidQuantity } from "./errors";

// Quantities and unit prices of securities (docs/data-model.md, "Money" and v0.6): exact decimals,
// as Postgres's `numeric` keeps them, computed on scaled integers and never with floating point. A
// fund's share can be 0.0347 of a unit and its price 112.4519 €; what they give is rounded to minor
// units, half away from zero, only when it meets money.

/** How many decimals a quantity or a unit price may have. */
export const DECIMALS = 10;

/** How many digits it may have before the point. */
export const INTEGER_DIGITS = 15;

const ONE = 10n ** BigInt(DECIMALS);

/** An exact decimal: `scaled` / 10^10. A position's quantity may be negative (incomplete). */
export type Decimal = { readonly scaled: bigint };

/** The decimal `scaled` / 10^10. */
export const decimalOf = (scaled: bigint): Decimal => ({ scaled });

export const ZERO: Decimal = decimalOf(0n);

const WRITTEN = /^(\d+)(?:[.,](\d+))?$/;

/**
 * A quantity or a unit price as written: digits, then `.` or `,` and decimals, spaces around left
 * out; at most 10 decimals and 15 digits before the point once leading and trailing zeros are left
 * out. No sign, no thousands separator, no exponent. `InvalidQuantity` otherwise.
 */
export function parseDecimal(text: string): Result.Result<Decimal, InvalidQuantity> {
  const match = WRITTEN.exec(text.trim());
  const whole = match?.[1]?.replace(/^0+(?=\d)/, "");
  const decimals = (match?.[2] ?? "").replace(/0+$/, "");

  if (whole === undefined || whole.length > INTEGER_DIGITS || decimals.length > DECIMALS) {
    return Result.fail(new InvalidQuantity({ text }));
  }

  return Result.succeed(decimalOf(BigInt(whole) * ONE + BigInt(decimals.padEnd(DECIMALS, "0"))));
}

/** As Postgres and the files write it: a point, and no trailing zero (`0.0347`, `12`). */
export function formatDecimal(value: Decimal): string {
  const negative = value.scaled < 0n;
  const magnitude = negative ? -value.scaled : value.scaled;
  const decimals = (magnitude % ONE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  const whole = (magnitude / ONE).toString();

  return `${negative ? "-" : ""}${whole}${decimals === "" ? "" : `.${decimals}`}`;
}

/** -1, 0 or 1, as `a` is below, equal to or above `b`. */
export function compareDecimals(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a.scaled === b.scaled) {
    return 0;
  }

  return a.scaled < b.scaled ? -1 : 1;
}

export const add = (a: Decimal, b: Decimal): Decimal => decimalOf(a.scaled + b.scaled);

export const subtract = (a: Decimal, b: Decimal): Decimal => decimalOf(a.scaled - b.scaled);

/**
 * `numerator` / `denominator` rounded to the nearest integer, half away from zero. The
 * denominator is never zero: every caller divides by a power of ten or a quantity held.
 */
export function roundDivide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  const quotient = top / bottom;
  const rounded = (top % bottom) * 2n >= bottom ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/** `a` × `b`, rounded to 10 decimals half away from zero. */
export const multiply = (a: Decimal, b: Decimal): Decimal =>
  decimalOf(roundDivide(a.scaled * b.scaled, ONE));

const minorScale = (minorUnits: number) => 10n ** BigInt(minorUnits);

/** An amount of a currency with `minorUnits` decimals, in its minor units, rounded. */
export const toMinor = (value: Decimal, minorUnits: number): number =>
  Number(roundDivide(value.scaled * minorScale(minorUnits), ONE));

/** What `quantity` units at `unitPrice` cost, in minor units, rounded once. */
export const productMinor = (quantity: Decimal, unitPrice: Decimal, minorUnits: number): number =>
  Number(roundDivide(quantity.scaled * unitPrice.scaled * minorScale(minorUnits), ONE * ONE));

/**
 * What one unit of `quantity` costs when they cost `minor` minor units together (an average cost):
 * in the currency's units, to 10 decimals, rounded. The quantity is never zero.
 */
export const perUnit = (minor: number, minorUnits: number, quantity: Decimal): Decimal =>
  decimalOf(roundDivide(BigInt(minor) * ONE * ONE, minorScale(minorUnits) * quantity.scaled));
