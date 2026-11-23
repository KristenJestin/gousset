import { describe, expect, test } from "vite-plus/test";

import { CURRENCY_CODES, isKnownCurrency, minorDigits } from "./index";

describe("minorDigits", () => {
  test("gives ISO 4217's own minor units, which differ from CLDR's for some", () => {
    // Intl's figures come from CLDR, which differ for some: IQD 0 there, ALL 0, CLF absent.
    const expected = {
      EUR: 2,
      USD: 2,
      JPY: 0,
      ISK: 0,
      KWD: 3,
      IQD: 3,
      ALL: 2,
      CLF: 4,
    } satisfies Record<string, number>;

    for (const [currency, digits] of Object.entries(expected)) {
      expect(minorDigits(currency), currency).toBe(digits);
    }
  });

  test("never throws, even for an empty or malformed code: two digits by default", () => {
    expect(minorDigits("")).toBe(2);
    expect(minorDigits("U")).toBe(2);
    expect(minorDigits("US")).toBe(2);
    expect(minorDigits("not-a-currency")).toBe(2);
  });
});

describe("CURRENCY_CODES", () => {
  test("is every well-formed, upper-case ISO 4217 code, once each", () => {
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }

    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
  });

  test("includes the currencies common accounts are held in", () => {
    for (const code of ["EUR", "USD", "GBP", "JPY", "CHF"]) {
      expect(CURRENCY_CODES).toContain(code);
    }
  });
});

describe("isKnownCurrency", () => {
  test("is true for a listed code, false otherwise", () => {
    expect(isKnownCurrency("EUR")).toBe(true);
    expect(isKnownCurrency("eur")).toBe(false);
    expect(isKnownCurrency("")).toBe(false);
  });
});
