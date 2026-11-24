import { Effect, Exit, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { AccountRecord, AccountStore } from "../account-store";
import { memoryAccountStore, memoryId } from "../account-store-memory";
import type { MemoryRows } from "../account-store-memory";
import { FutureMonthRefused } from "../errors";
import { Today } from "../today";
import type { Charge } from "./detection";
import { Subscriptions, monthSubscriptions, subscriptionCalendar } from "./subscriptions";

// A month's subscriptions and its calendar (#34), on made-up charges and a made-up meal card: the
// day detection looks from, a month to come refused, and what expires beside the subscriptions.
// The detection's own rules are `./detection`'s tests.

const TODAY = "2026-11-24";
const OWNER = "ada";

function charge(merchant: string, day: string, amountMinor: number): Charge {
  return { id: memoryId(), merchantId: merchant, merchant, day, amountMinor, currency: "EUR" };
}

const CHARGES = [
  ...["2026-07-08", "2026-08-08", "2026-09-08", "2026-10-08"].map((day) =>
    charge("Streamly", day, 949),
  ),
  charge("Streamly", "2026-11-08", 1099),
  ...["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map((day) =>
    charge("Fitclub", day, 2900),
  ),
];

function account(name: string, change: Partial<AccountRecord>): AccountRecord {
  return {
    id: memoryId(),
    name,
    kind: "benefit",
    envelope: null,
    institution: "MealCard",
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    settlesIntoAccountId: null,
    creditOrder: "oldest_first",
    balanceCategoryId: null,
    topUpDays: 3,
    topUpCapMinor: null,
    ...change,
  };
}

const meal = account("MealCard", {});
const closed = account("Old card", { closedOn: "2026-01-31" });

const ROWS: MemoryRows = {
  accounts: [meal, closed],
  lines: [
    {
      id: memoryId(),
      accountId: meal.id,
      bookedOn: "2026-01-05",
      valueOn: null,
      amountMinor: 18_000,
      label: "MEALCARD CREDIT",
      memo: null,
      counterpartyName: null,
      expiresOn: "2026-12-31",
    },
    {
      id: memoryId(),
      accountId: meal.id,
      bookedOn: "2026-11-12",
      valueOn: null,
      amountMinor: -4500,
      label: "CB CORNER CAFE",
      memo: null,
      counterpartyName: null,
    },
    {
      id: memoryId(),
      accountId: closed.id,
      bookedOn: "2025-12-01",
      valueOn: null,
      amountMinor: 5000,
      label: "OLD CREDIT",
      memo: null,
      counterpartyName: null,
      expiresOn: "2026-12-15",
    },
  ],
};

function run<A, E>(effect: Effect.Effect<A, E, Subscriptions | AccountStore>) {
  return Effect.runPromiseExit(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          memoryAccountStore(new Map([[OWNER, ROWS]])),
          Layer.succeed(Subscriptions, {
            charges: (_owner, range) =>
              Effect.succeed(
                CHARGES.filter((each) => each.day >= range.from && each.day <= range.to),
              ),
          }),
          Layer.succeed(Today, { day: Effect.succeed(TODAY) }),
        ),
      ),
    ),
  );
}

describe("monthSubscriptions", () => {
  test("reads the current month as of today, a past one as of its last day", async () => {
    const current = await run(monthSubscriptions(OWNER, "2026-11"));
    const past = await run(monthSubscriptions(OWNER, "2026-10"));

    expect(Exit.isSuccess(current) && current.value.asOf).toBe(TODAY);
    expect(Exit.isSuccess(current) && current.value.stopped.map((each) => each.merchant)).toEqual([
      "Fitclub",
    ]);
    expect(Exit.isSuccess(current) && current.value.rises.map((each) => each.merchant)).toEqual([
      "Streamly",
    ]);
    expect(Exit.isSuccess(past) && past.value.asOf).toBe("2026-10-31");
    expect(Exit.isSuccess(past) && past.value.recurring.map((each) => each.merchant)).toEqual([
      "Fitclub",
      "Streamly",
    ]);
  });

  test("refuses a month to come", async () => {
    const exit = await run(Effect.flip(monthSubscriptions(OWNER, "2026-12")));

    expect(Exit.isSuccess(exit) && exit.value).toEqual(
      new FutureMonthRefused({ month: "2026-12", current: "2026-11" }),
    );
  });
});

describe("subscriptionCalendar", () => {
  test("gives the month and the next: paid, due, stopped, and what expires with something left", async () => {
    const exit = await run(subscriptionCalendar(OWNER, "2026-11"));

    expect(Exit.isSuccess(exit)).toBe(true);

    const calendar = Exit.isSuccess(exit) ? exit.value : undefined;

    expect(calendar?.from).toBe("2026-11-01");
    expect(calendar?.to).toBe("2026-12-31");
    expect(calendar?.items.map((each) => [each.day, each.kind, each.name])).toEqual([
      ["2026-11-03", "stopped", "Fitclub"],
      ["2026-11-08", "paid", "Streamly"],
      ["2026-12-08", "due", "Streamly"],
      ["2026-12-31", "expiring", "MealCard"],
    ]);
    expect(calendar?.items.at(-1)).toMatchObject({
      kind: "expiring",
      accountId: meal.id,
      amount: { minor: 13_500, currency: "EUR" },
    });
  });

  test("refuses a month to come", async () => {
    const exit = await run(Effect.flip(subscriptionCalendar(OWNER, "2027-01")));

    expect(Exit.isSuccess(exit) && exit.value).toBeInstanceOf(FutureMonthRefused);
  });
});
