import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { addDays } from "../balances";
import { MIN_CHARGES, detectSubscriptions, nextDay } from "./detection";
import type { Charge } from "./detection";

// Every merchant and amount here is invented.

/** A charge of Streamly, its id made from its place in the input. */
function streamly(index: number, day: string, amountMinor: number): Charge {
  return {
    id: `charge-${String(index).padStart(4, "0")}`,
    merchantId: "merchant-streamly",
    merchant: "Streamly",
    look: { color: null, logo: null },
    day,
    amountMinor,
    currency: "EUR",
  };
}

/**
 * A clean monthly series: a random start, 3 to 30 charges, each within 3 days of the month after
 * the previous one (the tolerance is measured from the previous charge), one amount.
 */
const cleanSeries = fc
  .record({
    start: fc.integer({ min: 0, max: 1000 }),
    jitters: fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 2, maxLength: 29 }),
    amountMinor: fc.integer({ min: 100, max: 100_000 }),
  })
  .map(({ start, jitters, amountMinor }) => {
    const days = [addDays("2023-01-01", start)];

    for (const jitter of jitters) {
      days.push(addDays(nextDay(days.at(-1) ?? "", "monthly"), jitter));
    }

    return {
      amountMinor,
      charges: days.map((day, index) => streamly(index, day, amountMinor)),
    };
  });

/**
 * A clean series and noise: up to 10 other charges of Streamly around it, each of an amount at
 * least three times the series' and none the same as another's (3 to 20 times it, each multiple at
 * least 5 % from the next, beyond the 2 % of one price).
 */
const noisySeries = cleanSeries.chain(({ amountMinor, charges }) => {
  const first = charges[0]?.day ?? "";
  const span = Math.round((Date.parse(charges.at(-1)?.day ?? "") - Date.parse(first)) / 86_400_000);

  return fc
    .uniqueArray(
      fc.record({
        offset: fc.integer({ min: -60, max: span }),
        times: fc.integer({ min: 3, max: 20 }),
      }),
      { maxLength: 10, selector: (noise) => noise.times },
    )
    .map((noises) => ({
      amountMinor,
      charges,
      noise: noises.map(({ offset, times }, index) =>
        streamly(1000 + index, addDays(first, offset), amountMinor * times),
      ),
    }));
});

/** The last day of the charges, as the caller keeps them up to `asOf`. */
const lastDay = (charges: ReadonlyArray<Charge>) =>
  charges.map((each) => each.day).reduce((latest, day) => (day > latest ? day : latest), "");

describe("detectSubscriptions, whatever the series", () => {
  test("a clean monthly series is one monthly subscription at its amount", () => {
    fc.assert(
      fc.property(cleanSeries, ({ amountMinor, charges }) => {
        const found = detectSubscriptions(charges, lastDay(charges));

        expect(found).toHaveLength(1);
        expect(found[0]?.cadence).toBe("monthly");
        expect(found[0]?.usualMinor).toBe(amountMinor);
        expect(found[0]?.charges).toEqual(charges);
        expect(found[0]?.stoppedOn).toBeNull();
      }),
    );
  });

  test("noise of very different amounts never removes it", () => {
    fc.assert(
      fc.property(noisySeries, ({ amountMinor, charges, noise }) => {
        const all = [...charges, ...noise];
        const found = detectSubscriptions(all, lastDay(all));

        const kept = found.filter(
          (each) =>
            each.cadence === "monthly" &&
            each.usualMinor === amountMinor &&
            charges.every((clean) => each.charges.includes(clean)),
        );

        expect(kept).toHaveLength(1);
      }),
    );
  });

  test("the order of the input never changes the output", () => {
    fc.assert(
      fc.property(
        noisySeries.chain(({ charges, noise }) => {
          const all = [...charges, ...noise];

          return fc
            .shuffledSubarray(all, { minLength: all.length, maxLength: all.length })
            .map((shuffled) => ({ all, shuffled }));
        }),
        ({ all, shuffled }) => {
          const asOf = lastDay(all);

          expect(detectSubscriptions(shuffled, asOf)).toEqual(detectSubscriptions(all, asOf));
        },
      ),
    );
  });
});

/** Any charges of two merchants over a year, of a few amounts, so that series come by chance. */
const anyCharges = fc
  .array(
    fc.record({
      offset: fc.integer({ min: 0, max: 400 }),
      amountMinor: fc.constantFrom(450, 455, 999, 1299, 2900),
      merchant: fc.constantFrom("Fitbox", "Wavely Mobile"),
      currency: fc.constantFrom("EUR", "USD"),
    }),
    { maxLength: 120 },
  )
  .map((drawn) =>
    drawn.map(({ offset, amountMinor, merchant, currency }, index): Charge => ({
      id: `charge-${String(index).padStart(4, "0")}`,
      merchantId: `merchant-${merchant.toLowerCase().replaceAll(" ", "-")}`,
      merchant,
      look: { color: null, logo: null },
      day: addDays("2026-01-01", offset),
      amountMinor,
      currency,
    })),
  );

describe("detectSubscriptions, whatever the charges", () => {
  test("gives the same output when run twice, and on the input in any order", () => {
    fc.assert(
      fc.property(
        anyCharges.chain((charges) =>
          fc
            .shuffledSubarray(charges, { minLength: charges.length, maxLength: charges.length })
            .map((shuffled) => ({ charges, shuffled })),
        ),
        ({ charges, shuffled }) => {
          const once = detectSubscriptions(charges, "2027-02-10");

          expect(detectSubscriptions(charges, "2027-02-10")).toEqual(once);
          expect(detectSubscriptions(shuffled, "2027-02-10")).toEqual(once);
        },
      ),
      { numRuns: 300 },
    );
  });

  test("each charge is in one series at most, a series long enough, of one merchant and currency, never twice a day", () => {
    fc.assert(
      fc.property(anyCharges, (charges) => {
        const found = detectSubscriptions(charges, "2027-02-10");
        const seen = new Set<string>();

        for (const subscription of found) {
          expect(subscription.charges.length).toBeGreaterThanOrEqual(
            MIN_CHARGES[subscription.cadence],
          );
          expect(new Set(subscription.charges.map((each) => each.day)).size).toBe(
            subscription.charges.length,
          );

          for (const each of subscription.charges) {
            expect(seen.has(each.id)).toBe(false);
            seen.add(each.id);
            expect(each.merchantId).toBe(subscription.merchantId);
            expect(each.currency).toBe(subscription.currency);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
