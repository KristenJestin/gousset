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

const euros = (minor: number) => ({ minor, currency: "EUR" });

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

  test("stands on the month's last day once it is over", async () => {
    const { asOf } = await run(investments("ada", "2026-10"));

    expect(asOf).toBe("2026-10-31");
  });

  test("in the month under way, adds what was put in so far, at cost, with no growth yet", async () => {
    const [november] = madeUpMonth("2026-11").investments;
    const value = november?.valueMinor ?? 0;
    const putIn = november?.netContributionsMinor ?? 0;
    // The made-up transfer to the PEA is booked on the 12th.
    const before = await run(investments("ada", "2026-12"), "2026-12-05");
    const after = await run(investments("ada", "2026-12"), "2026-12-12");

    expect(before).toEqual({
      month: "2026-12",
      asOf: "2026-12-05",
      accounts: [
        {
          account: "Northbank PEA",
          value: euros(value),
          netContributions: euros(putIn),
          gain: euros(value - putIn),
        },
      ],
    });
    expect(after.accounts).toEqual([
      {
        account: "Northbank PEA",
        value: euros(value + 35_000),
        netContributions: euros(putIn + 35_000),
        gain: euros(value - putIn),
      },
    ]);
  });

  test("shows no investment in a month not begun", async () => {
    const { accounts } = await run(investments("ada", "2027-06"), "2026-12-05");

    expect(accounts).toEqual([]);
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

  test("has no statement to import in a month not begun", async () => {
    const state = await run(importState("ada", "2027-06"), "2026-12-05");

    expect(state).toEqual({ month: "2027-06", accounts: 0, imported: 0, partial: [] });
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
