import { Result } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  DECIMALS,
  compareDecimals,
  decimalOf,
  formatDecimal,
  multiply,
  parseDecimal,
  perUnit,
  productMinor,
  roundDivide,
  toMinor,
} from "./decimal";
import type { Decimal } from "./decimal";
import { InvalidQuantity } from "./errors";

// Quantities and unit prices of securities (docs/data-model.md, "Money" and v0.6): exact decimals
// on scaled integers, rounded to minor units half away from zero only when they meet money. Every
// number here is invented.

const parsed = (text: string): Decimal => Result.getOrThrow(parseDecimal(text));

/** Any decimal Gousset keeps: up to 15 digits before the point and 10 after, from 0. */
const kept = fc.bigInt({ min: 0n, max: 10n ** 25n - 1n }).map((scaled) => decimalOf(scaled));

/** A strictly positive one. */
const positive = fc.bigInt({ min: 1n, max: 10n ** 25n - 1n }).map((scaled) => decimalOf(scaled));

describe("an exact decimal", () => {
  test("is read with a point or a comma, and written with a point, without trailing zeros", () => {
    expect(formatDecimal(parsed("0.0347"))).toBe("0.0347");
    expect(formatDecimal(parsed("112,4519"))).toBe("112.4519");
    expect(formatDecimal(parsed("12"))).toBe("12");
    expect(formatDecimal(parsed(" 3.50 "))).toBe("3.5");
    expect(formatDecimal(parsed("0007.0000000000"))).toBe("7");
    expect(formatDecimal(parsed("0"))).toBe("0");
  });

  test("holds 10 decimals and 15 digits before the point, and is refused beyond", () => {
    expect(formatDecimal(parsed("999999999999999.9999999999"))).toBe("999999999999999.9999999999");
    expect(formatDecimal(parsed("0.00000000010"))).toBe("0.0000000001");

    for (const text of [
      "0.00000000001",
      "1000000000000000",
      "",
      " ",
      "-1",
      "+1",
      "1.",
      ".5",
      "1,000.5",
      "1 000",
      "1e3",
      "NaN",
      "0x10",
    ]) {
      expect(Result.isFailure(parseDecimal(text)), JSON.stringify(text)).toBe(true);
    }
  });

  test("names what it refused", () => {
    expect(parseDecimal("12.34567890123")).toEqual(
      Result.fail(new InvalidQuantity({ text: "12.34567890123" })),
    );
  });

  test("reads back what it writes, whatever the decimal", () => {
    fc.assert(
      fc.property(kept, (value) => {
        expect(parsed(formatDecimal(value))).toEqual(value);
        expect(parsed(formatDecimal(value).replace(".", ","))).toEqual(value);
      }),
    );
  });

  test("compares as numbers do", () => {
    expect(compareDecimals(parsed("0.5"), parsed("0.50"))).toBe(0);
    expect(compareDecimals(parsed("0.0347"), parsed("0.035"))).toBe(-1);
    expect(compareDecimals(parsed("10"), parsed("9.9999999999"))).toBe(1);

    fc.assert(
      fc.property(kept, kept, (a, b) => {
        // A sum rather than a negation: the negation of 0 is -0, which `toBe` tells from 0.
        expect(compareDecimals(a, b) + compareDecimals(b, a)).toBe(0);
        expect(compareDecimals(a, b) === 0).toBe(formatDecimal(a) === formatDecimal(b));
      }),
    );
  });

  test("multiplies exactly, rounding to 10 decimals half away from zero", () => {
    expect(formatDecimal(multiply(parsed("0.0347"), parsed("112.4519")))).toBe("3.90208093");
    expect(formatDecimal(multiply(parsed("0.00001"), parsed("0.000005")))).toBe("0.0000000001");
    expect(formatDecimal(multiply(parsed("0.00001"), parsed("0.0000049")))).toBe("0");

    fc.assert(
      fc.property(kept, kept, (a, b) => {
        expect(multiply(a, b)).toEqual(multiply(b, a));
        expect(multiply(a, parsed("1"))).toEqual(a);
      }),
    );
  });
});

describe("rounding half away from zero", () => {
  test("rounds a half away from zero, either sign", () => {
    expect(roundDivide(5n, 2n)).toBe(3n);
    expect(roundDivide(-5n, 2n)).toBe(-3n);
    expect(roundDivide(5n, -2n)).toBe(-3n);
    expect(roundDivide(7n, 3n)).toBe(2n);
    expect(roundDivide(8n, 3n)).toBe(3n);
    expect(roundDivide(-8n, 3n)).toBe(-3n);
    expect(roundDivide(0n, 7n)).toBe(0n);
  });

  test("gives the nearest integer, and the one away from zero at a tie", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.bigInt({ min: 1n, max: 10n ** 20n }),
        fc.boolean(),
        (numerator, magnitude, negativeDenominator) => {
          const denominator = negativeDenominator ? -magnitude : magnitude;
          const rounded = roundDivide(numerator, denominator);
          // How far the result is from the exact quotient, in units of 1 / (2 × |denominator|).
          const off = (rounded * denominator - numerator) * 2n;
          const away = rounded * denominator * numerator >= 0n;

          expect(off <= magnitude && off >= -magnitude).toBe(true);

          // At a tie, the result is the one further from zero.
          if (off === magnitude || off === -magnitude) {
            expect(away).toBe(true);
          }
        },
      ),
    );
  });

  test("meets money in its minor units", () => {
    expect(toMinor(parsed("12.345"), 2)).toBe(1235);
    expect(toMinor(parsed("12.344"), 2)).toBe(1234);
    expect(toMinor(parsed("12.5"), 0)).toBe(13);
    expect(toMinor(parsed("1.0005"), 3)).toBe(1001);
    // A purchase of 0.0347 units at 112.4519 € costs 3.90 €.
    expect(productMinor(parsed("0.0347"), parsed("112.4519"), 2)).toBe(390);
    expect(productMinor(parsed("3"), parsed("0.005"), 2)).toBe(2);
    // What one unit cost: 350.00 € for 3.1123 units.
    expect(formatDecimal(perUnit(35_000, 2, parsed("3.1123")))).toBe("112.457025351");
  });

  test("gives back the cost of what it was a unit price of", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        positive,
        fc.constantFrom(0, 2, 3),
        (minor, quantity, minorUnits) => {
          const unit = perUnit(minor, minorUnits, quantity);
          const back = productMinor(quantity, unit, minorUnits);

          // The unit price is rounded to 10 decimals: the cost it gives back is off by at most
          // half a unit of the tenth decimal for each unit held, and half a minor unit.
          const slack = Number(
            roundDivide(quantity.scaled * 10n ** BigInt(minorUnits), 10n ** BigInt(2 * DECIMALS)),
          );

          expect(Math.abs(back - minor)).toBeLessThanOrEqual(slack + 1);
        },
      ),
    );
  });
});
