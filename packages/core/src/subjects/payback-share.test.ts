import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { leftToUserOf, paybackStateOf, shareLeft } from "./payback-share";

// A subject paid back by someone else (#217): what of each expense is still the user's cost, and
// where the subject stands. Every subject, amount and day here is invented.

describe("the share of an expense left to the user", () => {
  test("counts in full until something comes back", () => {
    expect(shareLeft(4000, 25_185, 0)).toBe(4000);
  });

  test("counts nothing once paid back in full, or beyond the cost", () => {
    expect(shareLeft(4000, 25_185, 25_185)).toBe(0);
    // A work trip of 251.85 paid back 914.50: what comes beyond is the subject's difference.
    expect(shareLeft(4000, 25_185, 91_450)).toBe(0);
  });

  test("spreads what came back over the expenses by their cost, half away from zero", () => {
    // 100.00 spent, 40.00 back: each expense keeps 60 %.
    expect(shareLeft(2500, 10_000, 4000)).toBe(1500);
    // 0.05 × 1/2 = 0.025, rounded to 0.03.
    expect(shareLeft(5, 2, 1)).toBe(3);
    expect(shareLeft(-5, 2, 1)).toBe(-3);
  });

  test("leaves an expense as it is when nothing was spent", () => {
    expect(shareLeft(0, 0, 3000)).toBe(0);
  });

  test("is exact past what a float holds", () => {
    expect(shareLeft(9_007_199_254_740, 9_007_199_254_741, 1)).toBe(9_007_199_254_739);
  });

  /** Nets of one subject's expenses, and what came back. */
  const subject = fc.record({
    nets: fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 40 }),
    paidBack: fc.integer({ min: 0, max: 500_000_000 }),
  });

  test("is never negative nor above the net cost", () => {
    fc.assert(
      fc.property(subject, ({ nets, paidBack }) => {
        const spent = nets.reduce((sum, each) => sum + each, 0);

        for (const net of nets) {
          const left = shareLeft(net, spent, paidBack);

          expect(left).toBeGreaterThanOrEqual(0);
          expect(left).toBeLessThanOrEqual(net);
        }
      }),
    );
  });

  test("adds up to spent less what came back, within a minor unit per expense", () => {
    fc.assert(
      fc.property(subject, ({ nets, paidBack }) => {
        const spent = nets.reduce((sum, each) => sum + each, 0);
        const left = nets.reduce((sum, net) => sum + shareLeft(net, spent, paidBack), 0);

        expect(Math.abs(left - (spent - Math.min(paidBack, spent)))).toBeLessThanOrEqual(
          nets.length,
        );
      }),
    );
  });
});

describe("an expense's share among the user's subjects", () => {
  const nodes = [
    { id: "trip", parentId: null, name: "Work trip" },
    { id: "hotel", parentId: "trip", name: "Hotel" },
    { id: "holiday", parentId: null, name: "Shared holiday" },
    { id: "van", parentId: null, name: "Van" },
  ];

  const paidBack = [
    { subjectId: "trip", currency: "EUR", spentMinor: 10_000, paidBackMinor: 2500 },
    { subjectId: "holiday", currency: "EUR", spentMinor: 10_000, paidBackMinor: 5000 },
  ];

  const subjectsOf = new Map([
    ["night", ["hotel"]],
    ["both", ["hotel", "holiday"]],
    ["fuel", ["van"]],
  ]);

  const leftOf = leftToUserOf(nodes, paidBack, subjectsOf);

  test("a descendant's expense counts at its paid-back ancestor's share", () => {
    expect(leftOf("night", "EUR", 4000)).toBe(3000);
  });

  test("an expense on two takes the larger share paid back, never both", () => {
    expect(leftOf("both", "EUR", 4000)).toBe(2000);
  });

  test("an expense of no paid-back subject, or of another currency, counts in full", () => {
    expect(leftOf("fuel", "EUR", 4000)).toBe(4000);
    expect(leftOf("night", "USD", 4000)).toBe(4000);
    expect(leftOf("unknown", "EUR", 4000)).toBe(4000);
  });
});

const state = (spentMinor: number, paidBackMinor: number, asked = false, settled = false) =>
  paybackStateOf({
    spentMinor,
    paidBackMinor,
    askedOn: asked ? "2026-10-02" : null,
    settledOn: settled ? "2026-11-02" : null,
  });

describe("where a paid-back subject stands", () => {
  test("paid back when settled by hand, or when what came back reaches what was spent", () => {
    expect(state(10_000, 0, false, true)).toBe("paid_back");
    expect(state(10_000, 10_000)).toBe("paid_back");
    expect(state(25_185, 91_450)).toBe("paid_back");
  });

  test("partly when something came back, less than spent", () => {
    expect(state(10_000, 4000, true)).toBe("partly");
  });

  test("to ask when something came back before anything was spent", () => {
    // Neither reached what was spent (nothing) nor less than it: the doc's "otherwise".
    expect(state(0, 4000)).toBe("to_ask");
  });

  test("asked, then to ask, while nothing came back", () => {
    expect(state(10_000, 0, true)).toBe("asked");
    expect(state(10_000, 0)).toBe("to_ask");
    expect(state(0, 0)).toBe("to_ask");
  });
});
