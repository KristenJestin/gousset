import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { addDays } from "./balances";
import { creditsLeft, expiringOf } from "./credits";
import type { CountedLine, CreditOrder } from "./credits";

let made = 0;

/** A line of a benefit account; ids grow with the order lines are written in, as uuidv7 does. */
function line(
  bookedOn: string,
  amountMinor: number,
  expiresOn: string | null = null,
  label = amountMinor > 0 ? "MEALCARD CREDIT" : "CB GREENMARKET",
): CountedLine {
  made += 1;

  return {
    id: `00000000-0000-7000-8000-${String(made).padStart(12, "0")}`,
    bookedOn,
    amountMinor,
    label,
    expiresOn,
  };
}

/** What is left on each credit, in order of use, by the day it was credited. */
const leftOf = (result: ReturnType<typeof creditsLeft>) =>
  result.credits.map((credit) => [credit.creditedOn, credit.leftMinor]);

describe("creditsLeft", () => {
  test("two credits with different expiries: spending uses the oldest first", () => {
    const lines = [
      line("2026-01-05", 10_000, "2027-01-31"),
      line("2026-02-05", 10_000, "2026-12-31"),
      line("2026-02-10", -12_500),
    ];

    const result = creditsLeft(0, lines, "oldest_first");

    expect(leftOf(result)).toEqual([
      ["2026-01-05", 0],
      ["2026-02-05", 7500],
    ]);
    expect(result.uncoveredMinor).toBe(0);
  });

  test("the issuer's order uses first a newer credit that expires sooner", () => {
    const lines = [
      line("2026-01-05", 10_000, "2027-01-31"),
      line("2026-02-05", 10_000, "2026-12-31"),
      line("2026-03-01", 5000),
      line("2026-03-10", -12_500),
    ];

    const result = creditsLeft(0, lines, "expiring_first");

    // Soonest expiry first, the credit without one last.
    expect(leftOf(result)).toEqual([
      ["2026-02-05", 0],
      ["2026-01-05", 7500],
      ["2026-03-01", 5000],
    ]);
    expect(result.uncoveredMinor).toBe(0);
  });

  test("a payment beyond what is credited is covered by the next credit", () => {
    const lines = [
      line("2026-01-05", 5000, "2026-12-31"),
      line("2026-01-20", -8000),
      line("2026-02-05", 10_000, "2027-01-31"),
    ];

    const before = creditsLeft(0, lines.slice(0, 2), "oldest_first");

    expect(leftOf(before)).toEqual([["2026-01-05", 0]]);
    expect(before.uncoveredMinor).toBe(3000);

    const after = creditsLeft(0, lines, "oldest_first");

    expect(leftOf(after)).toEqual([
      ["2026-01-05", 0],
      ["2026-02-05", 7000],
    ]);
    expect(after.uncoveredMinor).toBe(0);
  });

  test("the opening balance is the oldest credit, with no line, no day and no expiry", () => {
    const lines = [line("2026-01-05", 10_000, "2026-06-30"), line("2026-01-20", -3000)];
    const oldest = creditsLeft(4000, lines, "oldest_first");

    expect(oldest.credits[0]).toEqual({
      lineId: null,
      creditedOn: null,
      label: null,
      amountMinor: 4000,
      leftMinor: 1000,
      expiresOn: null,
    });

    // In the issuer's order, a credit without expiry comes after every dated one.
    const expiring = creditsLeft(4000, lines, "expiring_first");

    expect(leftOf(expiring)).toEqual([
      ["2026-01-05", 7000],
      [null, 4000],
    ]);
  });

  test("a negative opening balance starts as uncovered, taken from the first credit", () => {
    const result = creditsLeft(-2000, [line("2026-01-05", 5000)], "oldest_first");

    expect(leftOf(result)).toEqual([["2026-01-05", 3000]]);
    expect(result.uncoveredMinor).toBe(0);
  });

  test("an expired credit with something left is still used: an expiry never skips one", () => {
    const lines = [
      line("2025-01-05", 5000, "2025-12-31"),
      line("2026-01-05", 5000, "2026-12-31"),
      line("2026-03-01", -2000),
    ];

    expect(leftOf(creditsLeft(0, lines, "oldest_first"))).toEqual([
      ["2025-01-05", 3000],
      ["2026-01-05", 5000],
    ]);
  });

  test("ties of expiry go by the day credited", () => {
    // Written in the other order, so that the id alone would put the later credit first.
    const later = line("2026-02-05", 1000, "2026-12-31");
    const earlier = line("2026-01-05", 1000, "2026-12-31");

    expect(leftOf(creditsLeft(0, [earlier, later], "expiring_first"))).toEqual([
      ["2026-01-05", 1000],
      ["2026-02-05", 1000],
    ]);
  });
});

describe("expiringOf", () => {
  test("sums what is left by expiry day, soonest first, leaving out used-up and undated credits", () => {
    const lines = [
      line("2026-01-05", 5000, "2026-12-31"),
      line("2026-01-06", 2000, "2026-06-30"),
      line("2026-01-07", 3000, "2026-12-31"),
      line("2026-01-08", 9000),
      line("2026-01-09", 4000, "2026-03-31"),
      line("2026-01-20", -4000),
    ];

    expect(expiringOf(creditsLeft(0, lines, "expiring_first").credits)).toEqual([
      { day: "2026-06-30", minor: 2000 },
      { day: "2026-12-31", minor: 8000 },
    ]);
  });
});

/** Any line of a benefit account over 2026, with or without an expiry. */
const anyLine = fc
  .record({
    offset: fc.integer({ min: 0, max: 364 }),
    amountMinor: fc.integer({ min: -50_000, max: 50_000 }),
    expiresIn: fc.option(fc.integer({ min: 0, max: 800 })),
  })
  .map(({ offset, amountMinor, expiresIn }) => {
    const bookedOn = addDays("2026-01-01", offset);

    return line(bookedOn, amountMinor, expiresIn === null ? null : addDays(bookedOn, expiresIn));
  });

const anyOrder = fc.constantFrom<CreditOrder>("oldest_first", "expiring_first");

describe("creditsLeft, whatever the lines", () => {
  test("what is left minus what is uncovered is the balance, each left within its credit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000, max: 50_000 }),
        fc.array(anyLine, { maxLength: 40 }),
        anyOrder,
        (opening, given, order) => {
          const lines = given.toSorted(
            (a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.id.localeCompare(b.id),
          );

          const result = creditsLeft(opening, lines, order);
          const left = result.credits.reduce((total, credit) => total + credit.leftMinor, 0);
          const balance = lines.reduce((total, each) => total + each.amountMinor, opening);

          expect(left - result.uncoveredMinor).toBe(balance);
          expect(result.uncoveredMinor).toBeGreaterThanOrEqual(0);

          for (const credit of result.credits) {
            expect(credit.leftMinor).toBeGreaterThanOrEqual(0);
            expect(credit.leftMinor).toBeLessThanOrEqual(credit.amountMinor);
          }

          if (result.uncoveredMinor > 0) {
            expect(result.credits.every((credit) => credit.leftMinor === 0)).toBe(true);
          }
        },
      ),
    );
  });
});
