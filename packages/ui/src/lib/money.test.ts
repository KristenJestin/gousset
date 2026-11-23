import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import {
  compare,
  formatMoney,
  formatPercent,
  breakdownBars,
  isSteady,
  minorDigits,
  monthBarLayout,
  moneyParts,
  rollSlots,
  toDecimalString,
} from "./money";

const MINUS = "−";
const NARROW_NO_BREAK_SPACE = " ";
const NO_BREAK_SPACE = " ";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** Any amount a ledger can hold: every safe integer of minor units. */
const anyMinor = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

const currencies = fc.constantFrom("EUR", "USD", "JPY", "KWD", "GBP", "CHF");

const locales = fc.constantFrom("en", "fr", "de", "en-GB", "fr-CH");

describe("minor units", () => {
  it("reads each currency's own minor units from Intl", () => {
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(minorDigits("KWD")).toBe(3);
  });

  it("writes minor units as an exact decimal", () => {
    expect(toDecimalString(123_450, 2)).toBe("1234.50");
    expect(toDecimalString(-5, 2)).toBe("-0.05");
    expect(toDecimalString(7, 3)).toBe("0.007");
    expect(toDecimalString(1234, 0)).toBe("1234");
    expect(toDecimalString(-0, 2)).toBe("0.00");
    expect(toDecimalString(Number.MAX_SAFE_INTEGER, 2)).toBe("90071992547409.91");
  });

  it("refuses a minor amount that is not a safe integer", () => {
    expect(() => formatMoney(eur(12.5), { locale: "en" })).toThrow(RangeError);
    expect(() => formatMoney(eur(Number.NaN), { locale: "en" })).toThrow(RangeError);
    expect(() => formatMoney(eur(Number.MAX_SAFE_INTEGER + 1), { locale: "en" })).toThrow(
      RangeError,
    );
    expect(() => toDecimalString(0.1, 2)).toThrow(RangeError);
  });

  it("refuses every non-integer", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }).filter((value) => !Number.isInteger(value)),
        (minor) => {
          expect(() => formatMoney(eur(minor), { locale: "en" })).toThrow(RangeError);
        },
      ),
    );
  });
});

describe("formatting money", () => {
  it("writes English and French as each locale does", () => {
    expect(formatMoney(eur(123_450), { locale: "en" })).toBe("€1,234.50");
    expect(formatMoney(eur(123_450), { locale: "fr" })).toBe(
      `1${NARROW_NO_BREAK_SPACE}234,50${NO_BREAK_SPACE}€`,
    );
  });

  it("follows the currency's minor units", () => {
    expect(formatMoney({ minor: 1234, currency: "JPY" }, { locale: "en" })).toBe("¥1,234");
    expect(formatMoney({ minor: 1234, currency: "KWD" }, { locale: "en" })).toBe(
      `KWD${NO_BREAK_SPACE}1.234`,
    );
  });

  it("writes a negative with a true minus, and a plus only when asked", () => {
    expect(formatMoney(eur(-8000), { locale: "en" })).toBe(`${MINUS}€80.00`);
    expect(formatMoney(eur(8000), { locale: "en" })).toBe("€80.00");
    expect(formatMoney(eur(2650), { locale: "en", sign: "always" })).toBe("+€26.50");
    expect(formatMoney(eur(0), { locale: "en", sign: "always" })).toBe("€0.00");
    expect(formatMoney(eur(-0), { locale: "en" })).toBe("€0.00");
  });

  it("writes whole units in summaries, rounding half away from zero", () => {
    expect(formatMoney(eur(312_000), { locale: "en", whole: true })).toBe("€3,120");
    expect(formatMoney(eur(312_050), { locale: "en", whole: true })).toBe("€3,121");
    expect(formatMoney(eur(-312_050), { locale: "en", whole: true })).toBe(`${MINUS}€3,121`);
    // Rounded to nothing, a small negative has no sign left.
    expect(formatMoney(eur(-40), { locale: "en", whole: true })).toBe("€0");
  });

  it("keeps every digit of the largest amounts (no float drift)", () => {
    expect(formatMoney(eur(Number.MAX_SAFE_INTEGER), { locale: "en" })).toBe(
      "€90,071,992,547,409.91",
    );
    expect(formatMoney(eur(-Number.MAX_SAFE_INTEGER), { locale: "en" })).toBe(
      `${MINUS}€90,071,992,547,409.91`,
    );
  });

  it("gives back the minor units from its digits, for any amount (round trip)", () => {
    fc.assert(
      fc.property(anyMinor, currencies, locales, (minor, currency, locale) => {
        const text = formatMoney({ minor, currency }, { locale });
        const digits = text.replaceAll(/\D/g, "");

        expect(BigInt(digits)).toBe(BigInt(Math.abs(minor)));
      }),
    );
  });

  it("writes −x as x with a minus (sign symmetry)", () => {
    fc.assert(
      fc.property(anyMinor, currencies, locales, fc.boolean(), (minor, currency, locale, whole) => {
        const positive = formatMoney({ minor: Math.abs(minor), currency }, { locale, whole });
        const negative = formatMoney({ minor: -Math.abs(minor), currency }, { locale, whole });

        if (positive.replaceAll(/\D/g, "").replaceAll("0", "") === "") {
          expect(negative).toBe(positive);
        } else {
          expect(negative.replace(MINUS, "")).toBe(positive);
          expect(negative).toContain(MINUS);
        }
      }),
    );
  });

  it("never writes a hyphen-minus", () => {
    fc.assert(
      fc.property(anyMinor, currencies, locales, (minor, currency, locale) => {
        expect(formatMoney({ minor, currency }, { locale })).not.toContain("-");
      }),
    );
  });

  it("gives the parts that make the text, for the digits' roll", () => {
    fc.assert(
      fc.property(anyMinor, currencies, locales, (minor, currency, locale) => {
        const money = { minor, currency };
        const parts = moneyParts(money, { locale });

        expect(parts.map((part) => part.value).join("")).toBe(formatMoney(money, { locale }));
      }),
    );
  });
});

describe("comparing to a reference", () => {
  it("gives the change as an amount and a percentage", () => {
    expect(compare(eur(42_000), eur(40_000))).toEqual({ change: eur(2000), percent: 5 });
    expect(compare(eur(32_000), eur(40_000))).toEqual({ change: eur(-8000), percent: -20 });
  });

  it("has no percentage against nothing", () => {
    expect(compare(eur(5000), eur(0))).toEqual({ change: eur(5000), percent: null });
  });

  it("rounds the percentage to a whole, half away from zero", () => {
    expect(compare(eur(10_250), eur(10_000)).percent).toBe(3);
    expect(compare(eur(9750), eur(10_000)).percent).toBe(-3);
    expect(compare(eur(10_049), eur(10_000)).percent).toBe(0);
  });

  it("refuses two currencies", () => {
    expect(() => compare(eur(1), { minor: 1, currency: "USD" })).toThrow(RangeError);
  });

  it("is steady when the change rounds to 0 %, or is nothing against nothing", () => {
    expect(isSteady(compare(eur(10_049), eur(10_000)))).toBe(true);
    expect(isSteady(compare(eur(0), eur(0)))).toBe(true);
    expect(isSteady(compare(eur(1), eur(0)))).toBe(false);
    expect(isSteady(compare(eur(10_100), eur(10_000)))).toBe(false);
  });

  it("signs the percentage as the change, and never goes under −100 % from a positive", () => {
    const amounts = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

    fc.assert(
      fc.property(amounts, amounts, (value, reference) => {
        const { change, percent } = compare(eur(value), eur(reference));

        expect(change.minor).toBe(value - reference);

        if (reference === 0) {
          expect(percent).toBeNull();
        } else {
          expect(percent).not.toBeNull();
          expect(Number.isInteger(percent)).toBe(true);
          expect(percent ?? 0).toBeGreaterThanOrEqual(-100);
          expect(Math.sign(percent ?? 0) * Math.sign(change.minor)).not.toBe(-1);
        }
      }),
    );
  });

  it("signs against a negative reference by the change too", () => {
    expect(compare(eur(-5000), eur(-10_000)).percent).toBe(50);
  });

  it("writes a percentage with its sign in each locale", () => {
    expect(formatPercent(5, { locale: "en", sign: "always" })).toBe("+5%");
    expect(formatPercent(-20, { locale: "en", sign: "always" })).toBe(`${MINUS}20%`);
    expect(formatPercent(0, { locale: "en", sign: "always" })).toBe("0%");
    expect(formatPercent(5, { locale: "fr", sign: "always" })).toBe(`+5${NO_BREAK_SPACE}%`);
    expect(formatPercent(-20, { locale: "en" })).toBe(`${MINUS}20%`);
  });
});

describe("the digits' roll", () => {
  it("keys each digit by its place from the decimal point", () => {
    const slots = rollSlots(moneyParts(eur(123_450), { locale: "en" }));

    expect(slots.map((slot) => slot.key)).toEqual([
      "currency0",
      "i3",
      "group0",
      "i2",
      "i1",
      "i0",
      "decimal0",
      "f0",
      "f1",
    ]);
    expect(slots.map((slot) => slot.digit)).toEqual([null, 1, null, 2, 3, 4, null, 5, 0]);
  });

  it("keeps the units in the same column when the number of digits changes", () => {
    const small = rollSlots(moneyParts(eur(900), { locale: "en" }));
    const large = rollSlots(moneyParts(eur(1_000_000), { locale: "en" }));

    expect(small.find((slot) => slot.key === "i0")?.digit).toBe(9);
    expect(large.find((slot) => slot.key === "i0")?.digit).toBe(0);
  });
});

describe("the bars", () => {
  it("cuts the month bar by role, on the money received", () => {
    const layout = monthBarLayout({
      received: eur(312_000),
      spent: eur(203_000),
      saved: eur(60_000),
      left: eur(49_000),
    });

    expect(layout.overspent).toBe(false);
    expect(layout.receivedMark).toBeNull();
    expect(layout.parts.map((part) => part.role)).toEqual(["spent", "saved", "left"]);
    expect(layout.parts[0]?.width).toBeCloseTo(65.06, 2);
    expect(layout.parts[1]?.x).toBeCloseTo(65.06, 2);
    expect(layout.parts.reduce((sum, part) => sum + part.width, 0)).toBeCloseTo(100, 6);
  });

  it("stretches an overspent month to what went out, and marks where the money received ended", () => {
    const layout = monthBarLayout({
      received: eur(200_000),
      spent: eur(230_000),
      saved: eur(20_000),
      left: eur(-50_000),
    });

    expect(layout.overspent).toBe(true);
    expect(layout.receivedMark).toBe(80);
    expect(layout.parts[2]?.width).toBe(0);
    expect(layout.parts[0]?.width).toBe(92);
    expect(layout.restricted).toBeNull();
  });

  it("hatches the restricted money at the end of the part left, never wider than it", () => {
    const figures = {
      received: eur(200_000),
      spent: eur(100_000),
      saved: eur(50_000),
      left: eur(50_000),
    };

    expect(monthBarLayout({ ...figures, restricted: eur(20_000) }).restricted).toEqual({
      x: 90,
      width: 10,
    });
    expect(monthBarLayout({ ...figures, restricted: eur(90_000) }).restricted).toEqual({
      x: 75,
      width: 25,
    });
    expect(monthBarLayout({ ...figures, restricted: eur(0) }).restricted).toBeNull();
    expect(monthBarLayout(figures).restricted).toBeNull();
  });

  it("keeps every part within the bar, whatever the figures", () => {
    const figure = fc.integer({ min: -1e12, max: 1e12 });

    fc.assert(
      fc.property(figure, figure, figure, figure, (received, spent, saved, left) => {
        const layout = monthBarLayout({
          received: eur(received),
          spent: eur(spent),
          saved: eur(saved),
          left: eur(left),
        });

        for (const part of layout.parts) {
          expect(part.width).toBeGreaterThanOrEqual(0);
          expect(part.x + part.width).toBeLessThanOrEqual(100.000001);
        }
      }),
    );
  });

  it("puts a breakdown's rows on one scale, with the benchmark's mark", () => {
    const bars = breakdownBars([
      { amount: eur(69_000), benchmark: eur(69_000) },
      { amount: eur(23_000), benchmark: eur(16_000) },
      { amount: eur(0) },
    ]);

    expect(bars[0]).toEqual({ width: 100, mark: 100, over: false });
    expect(bars[1]?.over).toBe(true);
    expect(bars[1]?.mark).toBeCloseTo(23.19, 2);
    expect(bars[2]).toEqual({ width: 0, mark: null, over: false });
    expect(breakdownBars([{ amount: eur(0), benchmark: eur(0) }])[0]?.width).toBe(0);
  });
});
