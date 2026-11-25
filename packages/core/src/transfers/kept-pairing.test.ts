import { describe, expect, test } from "vite-plus/test";

import { decidedLines, keptPairs, keptReplacements } from "./pairing";
import type { PairableLine } from "./pairing";

// The pairing at boot of the lines kept before v0.3 (#192): the import's rules, but a line whose
// entry the user or a rule of theirs classified, or which the user split, is never paired by it. Every amount and account is invented.

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

const toSavings = line("out", "current", "2026-09-03", -20_000);
const intoSavings = line("in", "savings", "2026-09-04", 20_000, { accountKind: "savings" });
const nobody = new Set<string>();

describe("the lines the user decided", () => {
  test("a line whose entry is still classified by default is not decided", () => {
    expect(decidedLines([{ lineId: "a", classifiedBy: "default" }])).toEqual(new Set());
  });

  test("a line whose entry a rule of the user's classified is decided", () => {
    expect(
      decidedLines([
        { lineId: "a", classifiedBy: "rule" },
        { lineId: "b", classifiedBy: "default" },
      ]),
    ).toEqual(new Set(["a"]));
  });

  test("a line whose entry the user classified is decided", () => {
    expect(decidedLines([{ lineId: "a", classifiedBy: "user" }])).toEqual(new Set(["a"]));
  });

  test("a line split across two entries is decided, whoever classified them", () => {
    expect(
      decidedLines([
        { lineId: "a", classifiedBy: "default" },
        { lineId: "a", classifiedBy: "default" },
        { lineId: "b", classifiedBy: "default" },
      ]),
    ).toEqual(new Set(["a"]));
  });
});

describe("the pairs the boot makes", () => {
  test("a clear pair the user decided nothing about is paired", () => {
    const pool = [toSavings, intoSavings];

    expect(keptPairs(pool, pool, nobody)).toEqual([{ outLineId: "out", inLineId: "in" }]);
  });

  test("a clear pair is left alone when the user decided either side", () => {
    const pool = [toSavings, intoSavings];

    expect(keptPairs(pool, pool, new Set(["out"]))).toEqual([]);
    expect(keptPairs(pool, pool, new Set(["in"]))).toEqual([]);
  });

  test("a line the user decided still counts as a candidate: the other one is not guessed", () => {
    const second = line("in-2", "savings", "2026-09-05", 20_000, { accountKind: "savings" });
    const pool = [toSavings, intoSavings, second];

    expect(keptPairs(pool, pool, new Set(["in-2"]))).toEqual([]);
  });

  test("a pair across a savings account's fortnight is paired", () => {
    const out = line("out", "current", "2026-09-17", -15_000);
    const into = line("in", "savings", "2026-10-01", 15_000, { accountKind: "savings" });
    const pool = [out, into];

    expect(keptPairs(pool, pool, nobody)).toEqual([{ outLineId: "out", inLineId: "in" }]);
  });
});

describe("the sides the app made that the boot replaces", () => {
  const made = line("made", "card", "2026-09-05", 30_000, { accountKind: "card" });
  const brought = line("brought", "card", "2026-09-04", 30_000, { accountKind: "card" });

  test("a side the app made is replaced by the line the user decided nothing about", () => {
    expect(keptReplacements([brought], [made], nobody)).toEqual([
      { counterpartId: "made", lineId: "brought" },
    ]);
  });

  test("it is kept when the user decided that line", () => {
    expect(keptReplacements([brought], [made], new Set(["brought"]))).toEqual([]);
  });

  test("it is kept when another line the user decided matches it too: the other one is not guessed", () => {
    const other = line("other", "card", "2026-09-06", 30_000, { accountKind: "card" });

    expect(keptReplacements([brought, other], [made], new Set(["other"]))).toEqual([]);
  });
});
