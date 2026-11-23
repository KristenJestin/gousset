import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import type { AccountKind } from "../account-values";
import { POOL_DAYS } from "./pair-lines";
import {
  LONGEST_TRANSFER_DAYS,
  TRANSFER_DAYS,
  cardDebits,
  clearPairs,
  isCandidate,
  replacedCounterparts,
  shiftDay,
} from "./pairing";
import type { CardLedger, PairableLine } from "./pairing";

// Every amount and account here is invented.

const line = (
  id: string,
  accountId: string,
  bookedOn: string,
  amountMinor: number,
  more: Partial<PairableLine> = {},
): PairableLine => ({
  id,
  accountId,
  accountKind: "current",
  currency: "EUR",
  bookedOn,
  valueOn: null,
  amountMinor,
  ...more,
});

const toSavings = line("out", "current", "2026-10-10", -25_000);
const intoSavings = line("in", "savings", "2026-10-11", 25_000);

describe("transfer candidates", () => {
  test("two lines of opposite amounts on two accounts, a few days apart, are candidates", () => {
    expect(isCandidate(toSavings, intoSavings)).toBe(true);
    expect(isCandidate(intoSavings, toSavings)).toBe(true);
  });

  test("the same account, the same sign, another amount, another currency or too far apart are not", () => {
    for (const other of [
      { ...intoSavings, accountId: "current" },
      { ...intoSavings, amountMinor: -25_000 },
      { ...intoSavings, amountMinor: 25_001 },
      { ...intoSavings, currency: "USD" },
      { ...intoSavings, bookedOn: "2026-10-15" },
    ]) {
      expect(isCandidate(toSavings, other)).toBe(false);
    }
  });

  test("a line of nothing is never a transfer", () => {
    expect(isCandidate({ ...toSavings, amountMinor: 0 }, { ...intoSavings, amountMinor: 0 })).toBe(
      false,
    );
  });

  test("value dates close together make two lines booked further apart candidates", () => {
    const late = { ...intoSavings, bookedOn: "2026-10-16", valueOn: "2026-10-10" };

    expect(isCandidate({ ...toSavings, valueOn: "2026-10-10" }, late)).toBe(true);
    expect(isCandidate(toSavings, late)).toBe(false);
  });
});

describe("clear pairs", () => {
  test("a clear pair is paired, the negative line going out", () => {
    expect(clearPairs([intoSavings, toSavings], [intoSavings, toSavings])).toEqual([
      { outLineId: "out", inLineId: "in" },
    ]);
  });

  test("two candidates: nothing is paired, the line waits for review", () => {
    const intoInvestments = line("in-2", "investments", "2026-10-09", 25_000);
    const pool = [toSavings, intoSavings, intoInvestments];

    expect(clearPairs(pool, pool)).toEqual([]);
  });

  test("a line whose only candidate has another candidate is not paired either", () => {
    const secondOut = line("out-2", "other-current", "2026-10-12", -25_000);
    const pool = [toSavings, intoSavings, secondOut];

    expect(clearPairs([toSavings], pool)).toEqual([]);
  });

  test("only the fresh lines are paired, against the whole pool", () => {
    const old = line("old-out", "current", "2026-09-10", -25_000);
    const oldIn = line("old-in", "savings", "2026-09-10", 25_000);
    const pool = [old, oldIn, toSavings, intoSavings];

    expect(clearPairs([intoSavings], pool)).toEqual([{ outLineId: "out", inLineId: "in" }]);
  });

  test("a line is the side of one pair at most, whatever the lines", () => {
    const lines = fc.array(
      fc.record({
        accountId: fc.constantFrom("a", "b", "c"),
        bookedOn: fc.constantFrom("2026-10-01", "2026-10-03", "2026-10-09"),
        amountMinor: fc.constantFrom(-100, 100, -200, 200),
      }),
      { maxLength: 12 },
    );

    fc.assert(
      fc.property(lines, (drafts) => {
        const pool = drafts.map((draft, index) =>
          line(`l${index}`, draft.accountId, draft.bookedOn, draft.amountMinor),
        );

        const pairs = clearPairs(pool, pool);
        const sides = pairs.flatMap((pair) => [pair.outLineId, pair.inLineId]);

        expect(new Set(sides).size).toBe(sides.length);

        for (const pair of pairs) {
          const out = pool.find((each) => each.id === pair.outLineId);
          const into = pool.find((each) => each.id === pair.inLineId);

          expect(out !== undefined && into !== undefined && isCandidate(out, into)).toBe(true);
          expect(out?.amountMinor).toBeLessThan(0);
        }
      }),
    );
  });
});

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** A line on a savings account of its own. */
const savings = (id: string, bookedOn: string, amountMinor: number) =>
  line(id, `savings-${id}`, bookedOn, amountMinor, { accountKind: "savings" });

describe("a savings account dates by the fortnight", () => {
  test("an outflow on a fortnight's first day and the inflow at the next boundary pair", () => {
    const out = line("out", "current", "2026-10-01", -30_000);
    const into = savings("in", "2026-10-16", 30_000);

    expect(isCandidate(out, into)).toBe(true);
    expect(clearPairs([out, into], [out, into])).toEqual([{ outLineId: "out", inLineId: "in" }]);
  });

  test("the same gap between two current accounts does not", () => {
    const out = line("out", "current", "2026-10-01", -30_000);
    const into = line("in", "other-current", "2026-10-16", 30_000);

    expect(isCandidate(out, into)).toBe(false);
    expect(clearPairs([out, into], [out, into])).toEqual([]);
  });

  test("two candidates in a fortnight go to review", () => {
    const out = line("out", "current", "2026-10-01", -30_000);
    const pool = [out, savings("in", "2026-10-16", 30_000), savings("in-2", "2026-10-09", 30_000)];

    expect(clearPairs(pool, pool)).toEqual([]);
  });

  test("the window ends a few days after the next boundary, whichever side comes first", () => {
    const out = line("out", "current", "2026-10-01", -30_000);

    expect(isCandidate(out, savings("in", "2026-10-20", 30_000))).toBe(true);
    expect(isCandidate(out, savings("in", "2026-10-21", 30_000))).toBe(false);

    // From the 16th, the next fortnight starts on the 1st of the next month.
    const late = line("late", "current", "2026-10-16", -30_000);

    expect(isCandidate(late, savings("in", "2026-11-05", 30_000))).toBe(true);
    expect(isCandidate(late, savings("in", "2026-11-06", 30_000))).toBe(false);

    // Money out of the savings account, dated before the current account's line.
    const withdrawn = savings("out", "2026-10-16", -30_000);

    expect(isCandidate(withdrawn, line("in", "current", "2026-10-30", 30_000))).toBe(true);
    expect(isCandidate(withdrawn, line("in", "current", "2026-11-06", 30_000))).toBe(false);
  });

  const KINDS: ReadonlyArray<AccountKind> = [
    "current",
    "savings",
    "card",
    "investment",
    "loan",
    "benefit",
  ];

  /** Any day of ten years, and a gap of up to six weeks after it. */
  const day = fc.integer({ min: 0, max: 3652 }).map((days) => shiftDay("2024-01-01", days));
  const gap = fc.integer({ min: 0, max: 42 });
  const kind = fc.constantFrom(...KINDS);

  test("whatever the days and kinds, the window is the same both ways, never under 4 days nor over 20", () => {
    fc.assert(
      fc.property(day, gap, kind, kind, (early, after, outKind, inKind) => {
        const out = line("out", "a", early, -100, { accountKind: outKind });
        const into = line("in", "b", shiftDay(early, after), 100, { accountKind: inKind });
        const paired = isCandidate(out, into);

        expect(isCandidate(into, out)).toBe(paired);

        if (after <= TRANSFER_DAYS) {
          expect(paired).toBe(true);
        }

        if (after > LONGEST_TRANSFER_DAYS) {
          expect(paired).toBe(false);
        }

        if (outKind !== "savings" && inKind !== "savings") {
          expect(paired).toBe(after <= TRANSFER_DAYS);
        }
      }),
    );
  });

  test("whatever the day, a savings line up to 4 days after the next fortnight's start pairs, not later", () => {
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: TRANSFER_DAYS }), (early, late) => {
        // The 16th, or the 1st of the next month: 31 days after a month's 1st is in the next one.
        const boundary =
          Number(early.slice(8, 10)) < 16
            ? `${early.slice(0, 8)}16`
            : `${shiftDay(`${early.slice(0, 8)}01`, 31).slice(0, 8)}01`;

        const out = line("out", "current", early, -100);

        expect(isCandidate(out, savings("in", shiftDay(boundary, late), 100))).toBe(true);
        expect(isCandidate(out, savings("in", shiftDay(boundary, TRANSFER_DAYS + 1), 100))).toBe(
          false,
        );
      }),
    );
  });

  // The import reads the lines `POOL_DAYS` around its own (pair-lines.ts): that must reach every
  // other candidate of a fresh line's candidate, or an ambiguous line would be paired by itself.
  test("the import's pool reaches every other candidate of a fresh line's candidate", () => {
    const near = fc.integer({ min: 0, max: LONGEST_TRANSFER_DAYS });

    fc.assert(
      fc.property(day, near, near, (first, toMiddle, toLast) => {
        const firstOut = line("first", "current", first, -100);
        const middle = savings("middle", shiftDay(first, toMiddle), 100);
        const lastOut = line("last", "other-current", shiftDay(middle.bookedOn, toLast), -100);

        if (isCandidate(firstOut, middle) && isCandidate(middle, lastOut)) {
          // Value dates may be further apart: the pool keeps 14 days of them on top.
          expect(daysBetween(first, lastOut.bookedOn)).toBeLessThanOrEqual(POOL_DAYS - 14);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test("value dates count by the fortnight too", () => {
    const out = line("out", "current", "2026-09-28", -30_000, { valueOn: "2026-10-01" });
    const into = savings("in", "2026-10-19", 30_000);

    expect(isCandidate(out, into)).toBe(false);
    expect(isCandidate(out, { ...into, valueOn: "2026-10-16" })).toBe(true);
  });
});

describe("a deferred card's monthly debit", () => {
  const debit = line("debit", "current", "2026-11-05", -41_230);

  const card: CardLedger = {
    accountId: "card",
    currency: "EUR",
    settlesInto: "current",
    // Owed at the end of each day: October's purchases, then November's first ones.
    balanceBefore: 0,
    lines: [
      { bookedOn: "2026-10-04", amountMinor: -12_000 },
      { bookedOn: "2026-10-18", amountMinor: -29_230 },
      { bookedOn: "2026-11-02", amountMinor: -4500 },
    ],
  };

  test("pairs with the card whose balance it pays, on one of the days before it", () => {
    expect(cardDebits([debit], [card])).toEqual([{ lineId: "debit", cardAccountId: "card" }]);
  });

  test("an amount the card never owed, or a card of another account, pairs nothing", () => {
    expect(cardDebits([{ ...debit, amountMinor: -41_231 }], [card])).toEqual([]);
    expect(cardDebits([debit], [{ ...card, settlesInto: "other-current" }])).toEqual([]);
    expect(cardDebits([{ ...debit, amountMinor: 41_230 }], [card])).toEqual([]);
  });

  test("a balance owed too long before the debit does not count", () => {
    expect(cardDebits([{ ...debit, bookedOn: "2026-12-20" }], [card])).toEqual([]);
  });

  test("two cards that owed the amount leave the debit for review", () => {
    expect(cardDebits([debit], [card, { ...card, accountId: "card-2" }])).toEqual([]);
  });
});

describe("a counterpart the card's own file replaces", () => {
  const made = line("made", "card", "2026-11-05", 41_230);

  test("the card's line of the same amount, a few days apart, replaces it", () => {
    const real = line("real", "card", "2026-11-06", 41_230);

    expect(replacedCounterparts([real], [made])).toEqual([
      { counterpartId: "made", lineId: "real" },
    ]);
  });

  test("the card's line booked days before the debit, within ten days, replaces it too", () => {
    const early = line("early", "card", "2026-10-31", 41_230);

    expect(replacedCounterparts([early], [made])).toEqual([
      { counterpartId: "made", lineId: "early" },
    ]);
    expect(replacedCounterparts([line("late", "card", "2026-11-16", 41_230)], [made])).toEqual([]);
  });

  test("two lines of the card that could be it replace nothing: the user chooses", () => {
    const one = line("one", "card", "2026-11-04", 41_230);
    const two = line("two", "card", "2026-11-07", 41_230);

    expect(replacedCounterparts([one, two], [made])).toEqual([]);
  });

  test("a line of another account or amount replaces nothing", () => {
    expect(replacedCounterparts([line("x", "other", "2026-11-05", 41_230)], [made])).toEqual([]);
    expect(replacedCounterparts([line("x", "card", "2026-11-05", 41_231)], [made])).toEqual([]);
  });
});
