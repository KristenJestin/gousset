import { madeUpMonth } from "@gousset/fixture";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { MonthOutOfRange } from "./errors";
import { FixtureLedger, Ledger, monthAsOf, monthCache } from "./ledger";

function onDay<A, E>(effect: Effect.Effect<A, E, Ledger>, day: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${day}T12:00:00Z`));

      return yield* effect;
    }).pipe(Effect.provide(Layer.mergeAll(FixtureLedger, TestClock.layer()))),
  );
}

const read = (month: string) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;

    return yield* ledger.month("ada", month);
  });

describe("monthAsOf", () => {
  // The made-up refund always comes after the payment it cancels part of.
  const made = madeUpMonth("2026-10");
  const { investments: september } = madeUpMonth("2026-09");
  const refunded = made.expenses.find((expense) => expense.refundLineIds.length > 0);
  const paidOn = refunded?.bookedOn ?? "";

  test("does not count a refund booked after the day", () => {
    const expense = monthAsOf(made, paidOn, september).expenses.find(
      (kept) => kept.id === refunded?.id,
    );

    const payment = made.lines.find((line) => line.id === refunded?.paymentLineIds[0]);

    expect(expense?.refundLineIds).toEqual([]);
    expect(expense?.netMinor).toBe(-(payment?.amountMinor ?? 0));
  });

  test("names only lines it keeps", () => {
    const asOf = monthAsOf(made, paidOn, september);
    const kept = new Set(asOf.lines.map((line) => line.id));

    for (const expense of asOf.expenses) {
      for (const id of [...expense.paymentLineIds, ...expense.refundLineIds]) {
        expect(kept.has(id)).toBe(true);
      }
    }
  });

  test("counts the refund once it is booked", () => {
    const expense = monthAsOf(made, "2026-10-31", september).expenses.find(
      (kept) => kept.id === refunded?.id,
    );

    expect(expense).toEqual(refunded);
  });
});

describe("the ledger's months", () => {
  test("reads up to ten years from today, either way", async () => {
    const [earliest, latest] = await onDay(
      Effect.all([read("2016-11"), read("2036-11")]),
      "2026-11-22",
    );

    expect(earliest.month).toBe("2016-11");
    expect(latest.lines).toEqual([]);
  });

  test("refuses a month further than that", async () => {
    for (const month of ["2016-10", "2036-12", "0001-01", "9999-12"]) {
      const error = await onDay(Effect.flip(read(month)), "2026-11-22");

      expect(error).toEqual(new MonthOutOfRange({ month, earliest: "2016-11", latest: "2036-11" }));
    }
  });
});

describe("monthCache", () => {
  test("keeps the most recently read months only", () => {
    const made: Array<string> = [];

    const cache = monthCache(2, (month) => {
      made.push(month);

      return madeUpMonth(month);
    });

    cache.get("2026-01");
    cache.get("2026-02");
    cache.get("2026-01");
    cache.get("2026-03");

    expect(cache.months()).toEqual(["2026-01", "2026-03"]);

    // Read again, a dropped month is made again; a kept one is not.
    cache.get("2026-01");
    cache.get("2026-02");
    expect(made).toEqual(["2026-01", "2026-02", "2026-03", "2026-02"]);
  });
});
