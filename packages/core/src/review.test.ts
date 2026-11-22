import { madeUpMonth } from "@gousset/fixture";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { FixtureLedger } from "./ledger";
import type { Ledger } from "./ledger";
import { flags, importState, investments, movements } from "./review";

/** Runs against a fresh made-up ledger, on a fixed day. */
function run<A, E>(effect: Effect.Effect<A, E, Ledger>, day = "2026-11-22") {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${day}T12:00:00Z`));

      return yield* effect;
    }).pipe(Effect.provide(Layer.mergeAll(FixtureLedger, TestClock.layer()))),
  );
}

/** The made-up benefit account's last line in the month: where its statement stops. */
function lastMealCardDay(month: string) {
  return madeUpMonth(month)
    .lines.filter((line) => line.accountId === "mealcard")
    .map((line) => line.bookedOn)
    .toSorted()
    .at(-1);
}

describe("movements", () => {
  test("tells what came in and what moved between the accounts, from → to", async () => {
    const { movements: rows } = await run(movements("ada", "2026-10"));

    const told = rows.map(
      (row) => `${row.from} → ${row.to}${row.note === null ? "" : ` (${row.note})`}`,
    );

    expect(told).toEqual(
      expect.arrayContaining([
        "Acme Consulting → Current account (Salary)",
        "Acme Consulting → MealCard (Meal vouchers)",
        "Current account → Livret A",
        "Current account → Northbank PEA",
      ]),
    );
    expect(rows).toHaveLength(4);
  });

  test("puts the purchase of securities on the line of the transfer that paid for it", async () => {
    const { movements: rows } = await run(movements("ada", "2026-10"));
    const pea = rows.find((row) => row.to === "Northbank PEA");

    const purchase = madeUpMonth("2026-10").lines.find((line) => line.kind === "purchase");

    expect(pea?.amount.minor).toBe(35_000);
    expect(pea?.bought).toEqual({
      name: "World index ETF",
      amount: { minor: -(purchase?.amountMinor ?? 0), currency: "EUR" },
    });
    expect(rows.find((row) => row.to === "Livret A")?.bought).toBeNull();
  });
});

describe("investments", () => {
  test("gives each investment account its value, net contributions and gain", async () => {
    const { accounts } = await run(investments("ada", "2026-10"));
    const [position] = madeUpMonth("2026-10").investments;

    expect(accounts).toEqual([
      {
        account: "Northbank PEA",
        value: { minor: position?.valueMinor, currency: "EUR" },
        netContributions: { minor: position?.netContributionsMinor, currency: "EUR" },
        gain: {
          minor: (position?.valueMinor ?? 0) - (position?.netContributionsMinor ?? 0),
          currency: "EUR",
        },
      },
    ]);
  });
});

describe("importState", () => {
  test("counts an account as imported when its statement reaches the month's end", async () => {
    const state = await run(importState("ada", "2026-10"));
    const mealCard = lastMealCardDay("2026-10") ?? "";
    const whole = mealCard === "2026-10-31";

    expect(state.accounts).toBe(4);
    expect(state.imported).toBe(whole ? 4 : 3);
    expect(state.partial).toEqual(whole ? [] : [{ account: "MealCard", coveredTo: mealCard }]);
  });

  test("asks the month under way to be imported up to today only", async () => {
    const state = await run(importState("ada", "2026-10"), "2026-10-02");

    expect(state.imported).toBe(state.accounts);
  });
});

describe("flags", () => {
  test("flags a recurring price that changed", async () => {
    const { flags: found } = await run(flags("ada", "2026-10"));

    expect(found).toContainEqual({
      kind: "price-change",
      merchant: "Streamly",
      before: { minor: 899, currency: "EUR" },
      now: { minor: 949, currency: "EUR" },
    });
    // The rent and the gym cost the same as before: nothing to say.
    expect(found.filter((flag) => flag.kind === "price-change")).toHaveLength(1);
  });

  test("does not flag the new price once it is the usual one", async () => {
    const { flags: found } = await run(flags("ada", "2027-02"), "2027-03-01");

    expect(found.filter((flag) => flag.kind === "price-change")).toEqual([]);
  });

  test("flags an account whose statement stops before the month's end", async () => {
    const { flags: found } = await run(flags("ada", "2026-10"));
    const mealCard = lastMealCardDay("2026-10") ?? "";

    expect(found.filter((flag) => flag.kind === "not-imported")).toEqual(
      mealCard === "2026-10-31"
        ? []
        : [{ kind: "not-imported", account: "MealCard", coveredTo: mealCard }],
    );
  });
});
