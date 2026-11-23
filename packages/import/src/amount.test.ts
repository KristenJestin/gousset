import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { minorDigits, readAmount } from "./amount";
import type { AmountSyntax } from "./amount";
import { InvalidField } from "./errors";

const QIF_EXAMPLE = "an amount such as -1,234.56, -1.234,56 or -1234,56";

const at = (text: string) => ({ field: "TRNAMT", text, line: 7 });

const read = (text: string, currency: string, syntax: AmountSyntax) =>
  Effect.runSync(readAmount(at(text), currency, syntax));

const refusal = (text: string, currency: string, syntax: AmountSyntax) =>
  Effect.runSync(Effect.flip(readAmount(at(text), currency, syntax)));

/** Any amount a ledger can hold: every safe integer of minor units. */
const anyMinor = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

const currencies = fc.constantFrom(
  { currency: "EUR", digits: 2 },
  { currency: "USD", digits: 2 },
  { currency: "JPY", digits: 0 },
  { currency: "KWD", digits: 3 },
);

/** Minor units written as a bank would, with its decimal mark and maybe its thousands groups. */
function written(minor: number, digits: number, mark: string, grouping: string): string {
  const units = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = units.slice(0, units.length - digits);
  const fraction = units.slice(units.length - digits);
  const grouped = whole.replaceAll(/\B(?=(\d{3})+$)/g, grouping);
  const text = digits === 0 ? grouped : `${grouped}${mark}${fraction}`;

  return minor < 0 ? `-${text}` : text;
}

describe("reading an amount", () => {
  test("reads any amount an OFX file writes, with a point or a comma, exactly", () => {
    fc.assert(
      fc.property(anyMinor, currencies, fc.constantFrom(".", ","), (minor, money, mark) => {
        const text = written(minor, money.digits, mark, "");

        expect(read(text, money.currency, "ofx")).toBe(minor);
      }),
    );
  });

  test("reads any amount a QIF file writes, its thousands grouped or not, exactly", () => {
    const styles = fc.constantFrom(
      { mark: ".", grouping: "," },
      { mark: ",", grouping: "." },
      { mark: ",", grouping: " " },
      { mark: ",", grouping: " " },
      { mark: ".", grouping: "'" },
      { mark: ",", grouping: "" },
    );

    fc.assert(
      fc.property(anyMinor, currencies, styles, (minor, money, style) => {
        // Without decimals, a lone `1.234` cannot be told from one and a fraction.
        fc.pre(money.digits > 0 || style.grouping === "");

        const text = written(minor, money.digits, style.mark, style.grouping);

        expect(read(text, money.currency, "qif")).toBe(minor);
      }),
    );
  });

  test("takes a leading plus, trailing zeros and a missing whole part", () => {
    expect(read("+45,00", "EUR", "ofx")).toBe(4500);
    expect(read("12.340", "EUR", "ofx")).toBe(1234);
    expect(read("-,99", "EUR", "ofx")).toBe(-99);
    expect(read("12", "EUR", "ofx")).toBe(1200);
    expect(read("-0.00", "EUR", "ofx")).toBe(0);
    expect(Object.is(read("-0.00", "EUR", "ofx"), -0)).toBe(false);
  });

  test("refuses more decimals than the currency has", () => {
    const expected = "an amount with at most 2 decimals, as EUR has";
    const cents = fc.integer({ min: 0, max: 99 });
    const extra = fc.integer({ min: 1, max: 9 });

    fc.assert(
      fc.property(cents, extra, (kept, digit) => {
        const text = `1.${String(kept).padStart(2, "0")}${String(digit)}`;

        expect(refusal(text, "EUR", "ofx")).toEqual(new InvalidField({ ...at(text), expected }));
      }),
    );
  });

  test("refuses a QIF amount whose only mark may group thousands or mark decimals", () => {
    const ambiguous = `${QIF_EXAMPLE}: "1,234" may be a thousand or a fraction`;

    expect(refusal("1,234", "EUR", "qif")).toEqual(
      new InvalidField({ ...at("1,234"), expected: ambiguous }),
    );

    expect(read("1,234,567", "EUR", "qif")).toBe(123_456_700);
  });

  test("reads a lone mark before three digits as decimals in a currency of three minor units", () => {
    // Every amount under a thousand is written so in KWD (`12.500`); a thousand written `1,250`,
    // with neither group nor decimals, is read as 1.250 (README, "QIF amounts").
    expect(read("12.500", "KWD", "qif")).toBe(12_500);
    expect(read("1,250", "KWD", "qif")).toBe(1250);
    expect(read("1,250.000", "KWD", "qif")).toBe(1_250_000);
  });

  test("takes each currency's minor units from ISO 4217", () => {
    // Intl's figures come from CLDR, which differs for some: IQD 0 there, ALL 0, CLF absent.
    const expected = { EUR: 2, USD: 2, JPY: 0, ISK: 0, KWD: 3, IQD: 3, ALL: 2, CLF: 4 };

    for (const [currency, digits] of Object.entries(expected)) {
      expect([currency, minorDigits(currency)]).toEqual([currency, digits]);
    }
  });

  test("refuses what is not an amount", () => {
    for (const text of ["", "-", "12.3.4", "1,2,3.45", "1.234,567.89", "12 EUR", "1e3", "--5"]) {
      expect(refusal(text, "EUR", "qif")).toBeInstanceOf(InvalidField);
    }

    for (const text of ["", "+", "1,234.56", "1 234,56", "12.3.4", "0x10"]) {
      expect(refusal(text, "EUR", "ofx")).toBeInstanceOf(InvalidField);
    }
  });

  test("keeps no more than 40 characters of the field in the error", () => {
    const digits = "9".repeat(1000);

    expect(refusal(digits, "EUR", "ofx")).toEqual(
      new InvalidField({
        ...at(`${"9".repeat(40)}…`),
        expected: "an amount small enough to be held exactly",
      }),
    );
  });

  test("refuses an amount too large to be held exactly", () => {
    expect(refusal("90071992547409.92", "EUR", "ofx")).toEqual(
      new InvalidField({
        ...at("90071992547409.92"),
        expected: "an amount small enough to be held exactly",
      }),
    );

    expect(read("90071992547409.91", "EUR", "ofx")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
