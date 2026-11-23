import { madeUpMonth } from "@gousset/fixture";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { FixtureLedger } from "./ledger";
import type { Ledger } from "./ledger";
import {
  approveLine,
  linesToReview,
  monthOverview,
  monthSummary,
  spending,
  spendingDays,
} from "./month";
import { Today, currentMonth } from "./today";

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
    expect(summary.receivedFrom).toEqual(["Salary", "Meal vouchers"]);
  });

  test("sets apart what is left on the benefit account", async () => {
    const summary = await run(monthSummary("ada", "2026-10"));

    const onMealCard = madeUpMonth("2026-10")
      .lines.filter((line) => line.accountId === "mealcard")
      .reduce((sum, line) => sum + line.amountMinor, 0);

    expect(summary.restricted.minor).toBe(Math.max(0, Math.min(summary.left.minor, onMealCard)));
  });

  test("compares the month with the six months before", async () => {
    const summary = await run(monthSummary("ada", "2026-10"));
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

    const spent = months.map((month) =>
      madeUpMonth(month).expenses.reduce((sum, expense) => sum + expense.netMinor, 0),
    );

    expect(summary.averageSpent?.minor).toBe(
      Math.round(spent.reduce((sum, value) => sum + value, 0) / months.length),
    );
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
    const byMerchant = await run(
      Effect.gen(function* () {
        // The made-up refund waits in the review: its expense counts in its row once approved.
        const { lines } = yield* linesToReview("ada", "2026-10");
        const refund = lines.find((line) => line.label.includes("REFUND"));

        yield* approveLine("ada", refund?.id ?? "");

        return yield* spending("ada", "2026-10", "merchant");
      }),
    );

    expect(byMerchant.rows.find((row) => row.name === "Riverside Gym")?.amount.minor).toBe(850);
  });

  test("keeps an expense with a line to review apart, and counts it in its row once approved", async () => {
    const [before, after] = await run(
      Effect.gen(function* () {
        const waiting = yield* spending("ada", "2026-10", "category");
        const { lines } = yield* linesToReview("ada", "2026-10");

        for (const line of lines) {
          yield* approveLine("ada", line.id);
        }

        return [waiting, yield* spending("ada", "2026-10", "category")] as const;
      }),
    );

    const rowsTotal = (rows: typeof before.rows) =>
      rows.reduce((sum, row) => sum + row.amount.minor, 0);

    expect(before.pending.minor).toBeGreaterThan(0);
    expect(rowsTotal(before.rows) + before.pending.minor).toBe(before.total.minor);
    expect(after.pending.minor).toBe(0);
    expect(rowsTotal(after.rows)).toBe(after.total.minor);
    expect(after.total).toEqual(before.total);
  });

  test("gives each row the average of the six months before as its benchmark", async () => {
    const byCategory = await run(spending("ada", "2026-10", "category"));
    const row = (name: string) => byCategory.rows.find((candidate) => candidate.name === name);

    // The rent is the same every month; the subscription's price rose this month.
    expect(row("Housing")?.benchmark?.minor).toBe(69_000);
    expect(row("Subscriptions")?.benchmark?.minor).toBe(899);
    expect(row("Subscriptions")?.amount.minor).toBe(949);
  });

  test("counts an expense in full in each of its subjects", async () => {
    const bySubject = await run(spending("ada", "2026-10", "subject"));

    const fuel = madeUpMonth("2026-10").expenses.filter(
      (expense) => expense.merchant === "Fuelstop",
    );

    const pendingFuel = bySubject.pending.minor;

    expect(bySubject.rows.find((row) => row.name === "Home")?.amount.minor).toBe(69_000);
    expect(
      (bySubject.rows.find((row) => row.name === "Van")?.amount.minor ?? 0) + pendingFuel,
    ).toBe(fuel.reduce((sum, expense) => sum + expense.netMinor, 0));
  });
});

describe("spendingDays", () => {
  test("runs a row's total day by day, against the month before, up to today", async () => {
    const result = await run(spendingDays("ada", "2026-11", "category", "Housing"));

    // The rent is paid on the 5th, in both months.
    expect(result.days).toHaveLength(30);
    expect(result.days[3]).toEqual({ date: "2026-11-04", current: 0, previous: 0 });
    expect(result.days[4]).toEqual({ date: "2026-11-05", current: 69_000, previous: 69_000 });
    expect(result.days[21]?.current).toBe(69_000);
    // After today (the 22nd), the month has no figure yet.
    expect(result.days[22]?.current).toBeNull();
    expect(result.days[22]?.previous).toBe(69_000);
  });
});

describe("monthOverview", () => {
  test("gives the summary with its three groupings", async () => {
    const overview = await run(monthOverview("ada", "2026-10"));

    expect(overview.byCategory.total).toEqual(overview.summary.spent);
    expect(overview.byMerchant.total).toEqual(overview.summary.spent);
    expect(overview.bySubject).toEqual(await run(spending("ada", "2026-10", "subject")));
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

  test("reads the day a caller provides, rather than the clock", async () => {
    const fixed = { day: Effect.succeed("2026-10-15") };

    const [month, summary] = await run(
      Effect.all([currentMonth, monthSummary("ada", "2026-10")]).pipe(
        Effect.provideService(Today, fixed),
      ),
    );

    expect(month).toBe("2026-10");
    // Nothing booked after the 15th: less spent than in the whole month.
    expect(summary.spent.minor).toBeLessThan(
      (await run(monthSummary("ada", "2026-10"))).spent.minor,
    );
  });
});
