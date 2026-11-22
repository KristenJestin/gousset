import { madeUpMonth } from "@gousset/fixture";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { FixtureLedger } from "./ledger";
import type { Ledger } from "./ledger";
import { approveLine, linesToReview, monthOverview, monthSummary, spending } from "./month";
import { currentMonth } from "./today";

/** Runs against a fresh made-up ledger, on a fixed day. */
function run<A, E>(effect: Effect.Effect<A, E, Ledger>, day = "2026-11-22") {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${day}T12:00:00Z`));

      return yield* effect;
    }).pipe(Effect.provide(Layer.mergeAll(FixtureLedger, TestClock.layer()))),
  );
}

describe("monthSummary", () => {
  test("cuts what came in into spent, set aside and left", async () => {
    const summary = await run(monthSummary("ada", "2026-10"));
    const { lines, expenses } = madeUpMonth("2026-10");

    const received = lines
      .filter((line) => line.kind === "income")
      .reduce((sum, line) => sum + line.amountMinor, 0);

    expect(summary.received.minor).toBe(received);
    expect(summary.spent.minor).toBe(expenses.reduce((sum, expense) => sum + expense.netMinor, 0));
    // The Livret A and the PEA.
    expect(summary.setAside.minor).toBe(25_000 + 35_000);
    expect(summary.left.minor).toBe(
      summary.received.minor - summary.spent.minor - summary.setAside.minor,
    );
    expect(summary.madeUp).toBe(true);
  });

  test("shows nothing booked after today", async () => {
    const summary = await run(monthSummary("ada", "2026-12"));

    expect(summary.received.minor).toBe(0);
    expect(summary.spent.minor).toBe(0);
  });
});

describe("spending", () => {
  test("adds up to what was spent, the largest first", async () => {
    const [byCategory, summary] = await run(
      Effect.all([spending("ada", "2026-10", "category"), monthSummary("ada", "2026-10")]),
    );

    expect(byCategory.total).toEqual(summary.spent);

    const amounts = byCategory.rows.map((row) => row.amount.minor);

    expect(amounts).toEqual(amounts.toSorted((a, b) => b - a));
    expect(byCategory.rows[0]?.name).toBe("Housing");
  });

  test("counts an expense at its net cost, its refund taken off", async () => {
    const byMerchant = await run(spending("ada", "2026-10", "merchant"));

    expect(byMerchant.rows.find((row) => row.name === "Riverside Gym")?.amount.minor).toBe(850);
  });
});

describe("monthOverview", () => {
  test("gives the summary with both groupings", async () => {
    const overview = await run(monthOverview("ada", "2026-10"));

    expect(overview.byCategory.total).toEqual(overview.summary.spent);
    expect(overview.byMerchant.total).toEqual(overview.summary.spent);
  });
});

describe("approveLine", () => {
  test("takes the line out of the review, for its owner only", async () => {
    const [before, after, someoneElse] = await run(
      Effect.gen(function* () {
        const waiting = yield* linesToReview("ada", "2026-10");
        const first = waiting.lines[0];

        if (first !== undefined) {
          yield* approveLine("ada", first.id);
        }

        return [
          waiting,
          yield* linesToReview("ada", "2026-10"),
          yield* linesToReview("bob", "2026-10"),
        ] as const;
      }),
    );

    expect(before.count).toBe(6);
    expect(after.count).toBe(5);
    expect(after.lines.map((line) => line.id)).not.toContain(before.lines[0]?.id);
    expect(someoneElse.count).toBe(6);
  });

  test("refuses a line already reviewed", async () => {
    const error = await run(
      Effect.gen(function* () {
        const { lines } = yield* linesToReview("ada", "2026-10");
        const id = lines[0]?.id ?? "";

        yield* approveLine("ada", id);

        return yield* Effect.flip(approveLine("ada", id));
      }),
    );

    expect(error._tag).toBe("LineAlreadyReviewed");
  });

  test("refuses a line that does not exist", async () => {
    const error = await run(Effect.flip(approveLine("ada", "2026-10-l99")));

    expect(error._tag).toBe("LineNotFound");
  });
});

describe("currentMonth", () => {
  test("reads the month from the clock", async () => {
    expect(await run(currentMonth, "2027-03-01")).toBe("2027-03");
  });
});
