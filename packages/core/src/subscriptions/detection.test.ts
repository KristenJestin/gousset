import { describe, expect, test } from "vite-plus/test";

import { addDays } from "../balances";
import { addMonths } from "../values";
import {
  MIN_CHARGES,
  TOLERANCE_DAYS,
  calendarDays,
  detectSubscriptions,
  nextDay,
  subscriptionsOfMonth,
} from "./detection";
import type { Charge } from "./detection";

// Every merchant and amount here is invented.

let made = 0;

/** An expense paid to a merchant; ids grow with the order charges are written in. */
function charge(day: string, amountMinor: number, merchant = "Streamly", currency = "EUR"): Charge {
  made += 1;

  return {
    id: `charge-${String(made).padStart(6, "0")}`,
    merchantId: `merchant-${merchant.toLowerCase().replaceAll(" ", "-")}`,
    merchant,
    day,
    amountMinor,
    currency,
  };
}

/** One charge on each of `days`, all of one amount. */
function series(days: ReadonlyArray<string>, amountMinor: number, merchant = "Streamly") {
  return days.map((day) => charge(day, amountMinor, merchant));
}

describe("nextDay", () => {
  test("a week is seven days", () => {
    expect(nextDay("2026-12-29", "weekly")).toBe("2027-01-05");
  });

  test("a month is the same day of the next month, clamped to its last day", () => {
    expect(nextDay("2026-01-05", "monthly")).toBe("2026-02-05");
    expect(nextDay("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDay("2028-01-31", "monthly")).toBe("2028-02-29");
    expect(nextDay("2026-03-31", "monthly")).toBe("2026-04-30");
    expect(nextDay("2026-12-15", "monthly")).toBe("2027-01-15");
  });

  test("a year is the same day of the next year, the 29th of February becoming the 28th", () => {
    expect(nextDay("2026-03-10", "yearly")).toBe("2027-03-10");
    expect(nextDay("2028-02-29", "yearly")).toBe("2029-02-28");
  });
});

describe("detectSubscriptions", () => {
  test("a monthly series of three charges is found; two are not", () => {
    const charges = series(["2026-01-05", "2026-02-05", "2026-03-05"], 999);
    const found = detectSubscriptions(charges, "2026-03-20");

    expect(found).toEqual([
      {
        merchantId: "merchant-streamly",
        merchant: "Streamly",
        currency: "EUR",
        cadence: "monthly",
        charges,
        usualMinor: 999,
        lastOn: "2026-03-05",
        lastMinor: 999,
        nextOn: "2026-04-05",
        priceRise: null,
        stoppedOn: null,
      },
    ]);
    expect(detectSubscriptions(charges.slice(1), "2026-03-20")).toEqual([]);
    expect(MIN_CHARGES).toEqual({ weekly: 4, monthly: 3, yearly: 2 });
  });

  test("a bank delay of three days is tolerated, four are not", () => {
    const three = series(["2026-01-05", "2026-02-08", "2026-03-05"], 999);

    expect(detectSubscriptions(three, "2026-03-20")).toHaveLength(1);

    const four = series(["2026-01-05", "2026-02-09", "2026-03-09"], 999);

    expect(detectSubscriptions(four, "2026-03-20")).toEqual([]);
    expect(TOLERANCE_DAYS).toEqual({ weekly: 1, monthly: 3, yearly: 7 });
  });

  test("a charge on the 31st is followed by the last day of February", () => {
    const charges = series(["2026-01-31", "2026-02-28", "2026-03-31"], 1499);
    const [found] = detectSubscriptions(charges, "2026-04-01");

    expect(found?.cadence).toBe("monthly");
    expect(found?.charges).toHaveLength(3);
    expect(found?.nextOn).toBe("2026-04-30");
  });

  test("a weekly series of four is found, a day late tolerated; three are not", () => {
    const charges = series(["2026-03-02", "2026-03-09", "2026-03-17", "2026-03-24"], 450, "Fitbox");
    const [found, ...others] = detectSubscriptions(charges, "2026-03-25");

    expect(others).toEqual([]);
    expect(found?.cadence).toBe("weekly");
    expect(found?.usualMinor).toBe(450);
    expect(found?.nextOn).toBe("2026-03-31");
    expect(detectSubscriptions(charges.slice(1), "2026-03-25")).toEqual([]);
  });

  test("a yearly pair of the same amount is found; of two amounts, not", () => {
    const pair = series(["2025-03-10", "2026-03-15"], 4900, "Cloudbox");
    const [found] = detectSubscriptions(pair, "2026-04-01");

    expect(found?.cadence).toBe("yearly");
    expect(found?.nextOn).toBe("2027-03-15");

    const differing = [
      charge("2025-03-10", 4900, "Cloudbox"),
      charge("2026-03-10", 5900, "Cloudbox"),
    ];

    expect(detectSubscriptions(differing, "2026-04-01")).toEqual([]);
  });

  test("monthly charges are monthly, though they also look yearly twelve apart", () => {
    const days = Array.from({ length: 14 }, (_, index) => `${addMonths("2025-01", index)}-05`);
    const found = detectSubscriptions(series(days, 999), "2026-02-10");

    expect(found.map((each) => [each.cadence, each.charges.length])).toEqual([["monthly", 14]]);
  });

  test("a bill that varies every month is no subscription", () => {
    const charges = [
      charge("2026-01-12", 6200, "Northwind Energy"),
      charge("2026-02-12", 5400, "Northwind Energy"),
      charge("2026-03-12", 7100, "Northwind Energy"),
      charge("2026-04-12", 4800, "Northwind Energy"),
      charge("2026-05-12", 6600, "Northwind Energy"),
    ];

    expect(detectSubscriptions(charges, "2026-05-20")).toEqual([]);
  });

  test("amounts that wobble within 2 % are one price", () => {
    const charges = [
      charge("2026-01-05", 1000),
      charge("2026-02-05", 1015),
      charge("2026-03-05", 990),
    ];

    expect(detectSubscriptions(charges, "2026-03-10")).toHaveLength(1);
  });

  test("a price rise is flagged on its month, then becomes the usual price the next", () => {
    const before = series(["2026-01-05", "2026-02-05", "2026-03-05"], 999);
    const rose = charge("2026-04-05", 1299);
    const [flagged] = detectSubscriptions([...before, rose], "2026-04-10");

    expect(flagged?.usualMinor).toBe(999);
    expect(flagged?.lastMinor).toBe(1299);
    expect(flagged?.priceRise).toEqual({ fromMinor: 999, toMinor: 1299 });
    expect(flagged?.nextOn).toBe("2026-05-05");

    const [next] = detectSubscriptions([...before, rose, charge("2026-05-05", 1299)], "2026-05-10");

    expect(next?.charges).toHaveLength(5);
    expect(next?.usualMinor).toBe(1299);
    expect(next?.priceRise).toBeNull();
  });

  test("a price that drops is not flagged", () => {
    const charges = [
      ...series(["2026-01-05", "2026-02-05", "2026-03-05"], 1299),
      charge("2026-04-05", 999),
    ];

    const [found] = detectSubscriptions(charges, "2026-04-10");

    expect(found?.charges).toHaveLength(4);
    expect(found?.priceRise).toBeNull();
    expect(found?.usualMinor).toBe(1299);
    expect(found?.lastMinor).toBe(999);
  });

  test("a one-off purchase after the series does not hide it", () => {
    const monthly = series(["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"], 999);

    const [found, ...others] = detectSubscriptions(
      [...monthly, charge("2026-04-20", 4500)],
      "2026-04-25",
    );

    expect(others).toEqual([]);
    expect(found?.charges).toEqual(monthly);
    expect(found?.priceRise).toBeNull();
  });

  test("a one-off purchase two days after a monthly charge is no price rise", () => {
    const monthly = series(["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"], 999);
    const [found] = detectSubscriptions([...monthly, charge("2026-04-07", 4500)], "2026-04-25");

    expect(found?.charges).toEqual(monthly);
    expect(found?.priceRise).toBeNull();
  });

  test("two subscriptions at one merchant are both found", () => {
    const lines = [
      ...series(["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"], 1999, "Wavely Mobile"),
      ...series(["2026-01-12", "2026-02-12", "2026-03-12", "2026-04-12"], 999, "Wavely Mobile"),
    ];

    const found = detectSubscriptions(lines, "2026-04-20");

    expect(found.map((each) => [each.merchant, each.usualMinor, each.charges.length])).toEqual([
      ["Wavely Mobile", 1999, 4],
      ["Wavely Mobile", 999, 4],
    ]);
  });

  test("currencies are kept apart", () => {
    const mixed = [
      charge("2026-01-08", 2900, "Fitbox", "EUR"),
      charge("2026-02-08", 2900, "Fitbox", "USD"),
      charge("2026-03-08", 2900, "Fitbox", "EUR"),
    ];

    expect(detectSubscriptions(mixed, "2026-03-10")).toEqual([]);

    const apart = [
      ...["2026-01-08", "2026-02-08", "2026-03-08"].map((day) =>
        charge(day, 2900, "Fitbox", "EUR"),
      ),
      ...["2026-01-20", "2026-02-20", "2026-03-20"].map((day) =>
        charge(day, 3100, "Fitbox", "USD"),
      ),
    ];

    expect(detectSubscriptions(apart, "2026-03-25").map((each) => each.currency)).toEqual([
      "EUR",
      "USD",
    ]);
  });

  test("a series is stopped once its tolerance has passed, not a day before", () => {
    const charges = series(["2026-01-05", "2026-02-05", "2026-03-05"], 999);

    expect(detectSubscriptions(charges, "2026-04-08")[0]?.stoppedOn).toBeNull();
    expect(detectSubscriptions(charges, "2026-04-09")[0]?.stoppedOn).toBe("2026-04-05");
  });

  test("the same price bought often at a bakery is no subscription", () => {
    // A baguette two or three times a week: there is always one a week or a month earlier.
    const baguettes = Array.from({ length: 40 }, (_, index) =>
      charge(addDays("2026-01-02", Math.floor(index * 2.5)), 120, "Corner Bakery"),
    );

    expect(detectSubscriptions(baguettes, "2026-04-30")).toEqual([]);
  });

  test("sorted by merchant name, then cadence", () => {
    const found = detectSubscriptions(
      [
        ...series(["2026-01-05", "2026-02-05", "2026-03-05"], 999, "Wavely Mobile"),
        ...series(["2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23"], 450, "Fitbox"),
        ...series(["2026-01-10", "2026-02-10", "2026-03-10"], 2900, "Fitbox"),
        ...series(["2025-03-01", "2026-03-01"], 4900, "Cloudbox"),
      ],
      "2026-03-12",
    );

    expect(found.map((each) => [each.merchant, each.cadence])).toEqual([
      ["Cloudbox", "yearly"],
      ["Fitbox", "weekly"],
      ["Fitbox", "monthly"],
      ["Wavely Mobile", "monthly"],
    ]);
  });

  test("a few thousand charges at one merchant are read in time", () => {
    // Three a day for three years, many at one price: every series is tried and refused.
    const charges = Array.from({ length: 3000 }, (_, index) =>
      charge(
        addDays("2023-12-01", Math.floor(index / 3)),
        index % 3 === 0 ? 350 : 120 + (index % 17),
        "Daily Cafe",
      ),
    );

    const started = performance.now();

    expect(detectSubscriptions(charges, "2026-11-30")).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

/** The merchants of subscriptions, in their order. */
const names = (each: ReadonlyArray<{ readonly merchant: string }>) =>
  each.map((subscription) => subscription.merchant);

describe("subscriptionsOfMonth", () => {
  // Streamly goes on; Fitbox stopped, seen in September; Wavely Mobile's stop is seen on asOf.
  const asOf = "2026-11-24";

  const subscriptions = detectSubscriptions(
    [
      ...series(["2026-08-05", "2026-09-05", "2026-10-05"], 999),
      charge("2026-11-05", 1299),
      ...series(["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"], 2900, "Fitbox"),
      ...series(["2026-08-20", "2026-09-20", "2026-10-20"], 1999, "Wavely Mobile"),
    ],
    asOf,
  );

  test("the current month: what goes on, what stopped up to today, the price rises", () => {
    const month = subscriptionsOfMonth(subscriptions, "2026-11", asOf);

    expect(names(month.recurring)).toEqual(["Streamly"]);
    expect(names(month.stopped)).toEqual(["Wavely Mobile"]);
    expect(names(month.rises)).toEqual(["Streamly"]);
  });

  test("a past month: its stops only, no rise of another month", () => {
    const month = subscriptionsOfMonth(subscriptions, "2026-09", asOf);

    expect(names(month.recurring)).toEqual(["Streamly"]);
    expect(names(month.stopped)).toEqual(["Fitbox"]);
    expect(month.rises).toEqual([]);
  });

  test("a stop is not seen before the day after its tolerance", () => {
    const before = detectSubscriptions(
      series(["2026-08-20", "2026-09-20", "2026-10-20"], 1999, "Wavely Mobile"),
      "2026-11-23",
    );

    const month = subscriptionsOfMonth(before, "2026-11", "2026-11-23");

    expect(names(month.recurring)).toEqual(["Wavely Mobile"]);
    expect(month.stopped).toEqual([]);
  });
});

describe("calendarDays", () => {
  const streamly = [
    ...series(["2026-01-05", "2026-02-05", "2026-03-05"], 999),
    charge("2026-04-05", 1299),
  ];

  const fitbox = series(["2025-12-10", "2026-01-10", "2026-02-10"], 2900, "Fitbox");
  const subscriptions = detectSubscriptions([...streamly, ...fitbox], "2026-04-10");

  test("what was paid, what is due after today at the latest price and what stopped, by day then name", () => {
    const items = calendarDays(subscriptions, "2026-03-01", "2026-06-30", "2026-04-10");

    expect(
      items.map((item) => [item.day, item.kind, item.name, item.amount.minor, item.priceRise]),
    ).toEqual([
      ["2026-03-05", "paid", "Streamly", 999, null],
      ["2026-03-10", "stopped", "Fitbox", 2900, null],
      ["2026-04-05", "paid", "Streamly", 1299, { beforeMinor: 999 }],
      ["2026-05-05", "due", "Streamly", 1299, null],
      ["2026-06-05", "due", "Streamly", 1299, null],
    ]);
    expect(items[0]?.id).toBe(streamly[2]?.id);
    expect(items[0]?.merchantId).toBe("merchant-streamly");
    expect(items[0]?.amount.currency).toBe("EUR");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  test("nothing is due on today or before it", () => {
    const items = calendarDays(subscriptions, "2026-05-01", "2026-05-31", "2026-05-05");

    expect(items).toEqual([]);
  });

  test("ids stay the same from one call to the next", () => {
    const once = calendarDays(subscriptions, "2026-03-01", "2026-06-30", "2026-04-10");
    const again = calendarDays(subscriptions, "2026-04-01", "2026-06-30", "2026-04-10");

    expect(again.map((item) => item.id)).toEqual(
      once.flatMap((item) => (item.day >= "2026-04-01" ? [item.id] : [])),
    );
  });
});
