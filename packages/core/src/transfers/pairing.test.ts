import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { cardDebits, clearPairs, isCandidate, replacedCounterparts } from "./pairing";
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
