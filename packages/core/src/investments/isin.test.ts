import { Result } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { InvalidIsin } from "./errors";
import { isinCheckDigit, parseIsin } from "./isin";

// An ISIN's check digit (ISO 6166): its letters read as numbers (A = 10 … Z = 35), then the Luhn
// sum. Every ISIN here is invented, in the country code `XX`, which no country has.

const BODY = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Nine letters or digits after `XX`: the part an ISIN's check digit is computed from. */
const body = fc
  .array(fc.constantFrom(...BODY), { minLength: 9, maxLength: 9 })
  .map((characters) => `XX${characters.join("")}`);

describe("an ISIN", () => {
  test("ends with the check digit of the rest", () => {
    // X is 33: 3333000000000, whose Luhn check digit is 2.
    expect(isinCheckDigit("XX000000000")).toBe(2);
    expect(parseIsin("XX0000000002")).toEqual(Result.succeed("XX0000000002"));
    expect(Result.isFailure(parseIsin("XX0000000001"))).toBe(true);
  });

  test("is read in any case, its spaces left out", () => {
    expect(parseIsin(" xx00 0000 0002 ")).toEqual(Result.succeed("XX0000000002"));
  });

  test("of any other shape is refused, naming what was given", () => {
    for (const given of ["", "XX000000002", "XX00000000020", "X10000000002", "XX000000000A"]) {
      expect(parseIsin(given)).toEqual(Result.fail(new InvalidIsin({ isin: given })));
    }
  });

  test("is accepted with its check digit, and refused with any other", () => {
    fc.assert(
      fc.property(body, fc.integer({ min: 1, max: 9 }), (rest, shift) => {
        const digit = isinCheckDigit(rest);

        expect(Result.isSuccess(parseIsin(`${rest}${String(digit)}`))).toBe(true);
        expect(Result.isFailure(parseIsin(`${rest}${String((digit + shift) % 10)}`))).toBe(true);
      }),
    );
  });

  test("with one digit of it mistyped is refused", () => {
    fc.assert(
      fc.property(
        body,
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 1, max: 9 }),
        (rest, at, shift) => {
          const isin = `${rest}${String(isinCheckDigit(rest))}`;
          const typed = isin.charAt(at);
          const digit = Number(typed);

          fc.pre(/\d/.test(typed));

          const mistyped = `${isin.slice(0, at)}${String((digit + shift) % 10)}${isin.slice(at + 1)}`;

          expect(Result.isFailure(parseIsin(mistyped))).toBe(true);
        },
      ),
    );
  });
});
