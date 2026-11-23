import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  addDays,
  balanceAt,
  balanceCheck,
  balancesAfter,
  dailyBalances,
  daysFrom,
  groupAccounts,
  looksEmpty,
  totalsByCurrency,
} from "./balances";

const byLines = { mode: "lines" as const, openingBalanceMinor: 10_000 };
const byBalance = { mode: "balance" as const, openingBalanceMinor: 10_000 };

/** Any amount a ledger holds, kept small enough that thousands of them add up exactly. */
const anyMinor = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

/** A day of 2020 to 2030. */
const anyDay = fc.integer({ min: 0, max: 3652 }).map((offset) => addDays("2020-01-01", offset));

describe("days", () => {
  test("move across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysFrom("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysFrom("2026-10-01", "2026-10-31")).toBe(31);
    expect(daysFrom("2026-10-02", "2026-10-01")).toBe(0);
  });

  test("count what adding gives, whatever the day", () => {
    fc.assert(
      fc.property(anyDay, fc.integer({ min: 0, max: 800 }), (day, count) => {
        expect(daysFrom(day, addDays(day, count))).toBe(count + 1);
      }),
    );
  });
});

describe("balanceAt", () => {
  test("adds the counted lines to the opening balance, kept by lines", () => {
    expect(balanceAt(byLines, -2500, [], "2026-10-31")).toBe(7500);
  });

  test("reads the latest balance noted by then, kept by balance", () => {
    const noted = [
      { day: "2026-09-30", minor: 12_000 },
      { day: "2026-10-31", minor: 13_000 },
    ];

    expect(balanceAt(byBalance, 999, noted, "2026-09-29")).toBe(10_000);
    expect(balanceAt(byBalance, 999, noted, "2026-09-30")).toBe(12_000);
    expect(balanceAt(byBalance, 999, noted, "2026-10-30")).toBe(12_000);
    expect(balanceAt(byBalance, 999, noted, "2026-11-15")).toBe(13_000);
  });
});

describe("balancesAfter", () => {
  test("gives each line, newest first, the balance after it", () => {
    const newestFirst = [{ amountMinor: -300 }, { amountMinor: 5000 }, { amountMinor: -1200 }];

    expect(balancesAfter(newestFirst, 10_000)).toEqual([13_500, 13_800, 8800]);
  });

  test("steps by each line's amount and ends on the sum of them all", () => {
    fc.assert(
      fc.property(fc.array(anyMinor, { maxLength: 200 }), anyMinor, (amounts, before) => {
        const lines = amounts.map((amountMinor) => ({ amountMinor }));
        const after = balancesAfter(lines, before);
        const total = amounts.reduce((sum, amount) => sum + amount, 0);

        expect(after).toHaveLength(lines.length);

        if (lines.length > 0) {
          expect(after[0]).toBe(before + total);
          expect(after.at(-1)).toBe(before + (amounts.at(-1) ?? 0));
        }

        for (let index = 0; index + 1 < after.length; index += 1) {
          expect((after[index] ?? 0) - (after[index + 1] ?? 0)).toBe(amounts[index]);
        }
      }),
    );
  });
});

describe("dailyBalances", () => {
  test("gives every day of the range, a day without lines keeping the day before's", () => {
    const moves = [
      { day: "2026-10-02", minor: -500 },
      { day: "2026-10-04", minor: 2000 },
    ];

    expect(
      dailyBalances(byLines, { from: "2026-10-01", to: "2026-10-05" }, 10_000, moves, []),
    ).toEqual([
      { day: "2026-10-01", minor: 10_000 },
      { day: "2026-10-02", minor: 9500 },
      { day: "2026-10-03", minor: 9500 },
      { day: "2026-10-04", minor: 11_500 },
      { day: "2026-10-05", minor: 11_500 },
    ]);
  });

  test("draws the noted balances as steps, kept by balance", () => {
    const noted = [{ day: "2026-10-02", minor: 15_000 }];

    expect(
      dailyBalances(byBalance, { from: "2026-10-01", to: "2026-10-03" }, 0, [], noted).map(
        (balance) => balance.minor,
      ),
    ).toEqual([10_000, 15_000, 15_000]);
  });

  test("covers each day once and ends on the balance before plus every move", () => {
    fc.assert(
      fc.property(
        anyDay,
        fc.integer({ min: 0, max: 120 }),
        anyMinor,
        fc.array(fc.tuple(fc.integer({ min: 0, max: 120 }), anyMinor), { maxLength: 60 }),
        (from, length, before, picked) => {
          const to = addDays(from, length);

          const moves = picked.flatMap(([offset, minor]) =>
            offset <= length ? [{ day: addDays(from, offset), minor }] : [],
          );

          const balances = dailyBalances(byLines, { from, to }, before, moves, []);
          const total = moves.reduce((sum, move) => sum + move.minor, 0);

          expect(balances).toHaveLength(length + 1);
          expect(balances[0]?.day).toBe(from);
          expect(balances.at(-1)?.day).toBe(to);
          expect(balances.at(-1)?.minor).toBe(before + total);
          expect(new Set(balances.map((balance) => balance.day)).size).toBe(length + 1);
        },
      ),
    );
  });
});

describe("totalsByCurrency", () => {
  test("totals each currency apart, never converted, by code", () => {
    expect(
      totalsByCurrency([
        { minor: 1000, currency: "USD" },
        { minor: 250, currency: "EUR" },
        { minor: -50, currency: "USD" },
      ]),
    ).toEqual([
      { minor: 250, currency: "EUR" },
      { minor: 950, currency: "USD" },
    ]);
  });

  test("keeps every currency's sum, once each", () => {
    const currencies = fc.constantFrom("EUR", "USD", "JPY", "CHF");

    fc.assert(
      fc.property(fc.array(fc.record({ minor: anyMinor, currency: currencies })), (amounts) => {
        const totals = totalsByCurrency(amounts);

        expect(new Set(totals.map((total) => total.currency)).size).toBe(totals.length);

        for (const total of totals) {
          const sum = amounts
            .filter((amount) => amount.currency === total.currency)
            .reduce((all, amount) => all + amount.minor, 0);

          expect(total.minor).toBe(sum);
        }

        expect(totals.length).toBe(new Set(amounts.map((amount) => amount.currency)).size);
      }),
    );
  });
});

const account = (
  id: string,
  name: string,
  kind: "current" | "savings" | "card" | "investment" | "loan" | "benefit",
  minor: number,
  currency = "EUR",
  closedOn: string | null = null,
) => ({ id, name, institution: null, kind, closedOn, balance: { minor, currency } });

describe("groupAccounts", () => {
  test("puts each kind in its group, in the page's order, with totals per currency", () => {
    const { groups, closed } = groupAccounts([
      account("1", "Savings", "savings", 500_000),
      account("2", "Current", "current", 120_000),
      account("3", "Card", "card", -30_000),
      account("4", "Meal vouchers", "benefit", 8000),
      account("5", "Brokerage", "investment", 1_000_000, "USD"),
      account("6", "Mortgage", "loan", -9_000_000),
      account("7", "Old account", "current", 4200, "EUR", "2025-12-31"),
    ]);

    expect(groups.map((group) => group.group)).toEqual([
      "available",
      "restricted",
      "invested",
      "owed",
    ]);
    expect(groups.map((group) => group.accounts.map((each) => each.name))).toEqual([
      ["Card", "Current"],
      ["Meal vouchers"],
      ["Brokerage", "Savings"],
      ["Mortgage"],
    ]);
    expect(groups.map((group) => group.totals)).toEqual([
      [{ minor: 90_000, currency: "EUR" }],
      [{ minor: 8000, currency: "EUR" }],
      [
        { minor: 500_000, currency: "EUR" },
        { minor: 1_000_000, currency: "USD" },
      ],
      [{ minor: -9_000_000, currency: "EUR" }],
    ]);
    expect(closed.map((each) => each.name)).toEqual(["Old account"]);
  });

  test("lists every group, even an empty one", () => {
    expect(groupAccounts([]).groups.map((group) => [group.group, group.accounts.length])).toEqual([
      ["available", 0],
      ["restricted", 0],
      ["invested", 0],
      ["owed", 0],
    ]);
  });
});

describe("balanceCheck", () => {
  test("is null without a statement balance", () => {
    expect(balanceCheck(null, () => 0)).toBeNull();
  });

  test("agrees when the app counts what the statement says on its day", () => {
    expect(balanceCheck({ day: "2026-10-31", minor: 5000 }, () => 5000)).toEqual({
      day: "2026-10-31",
      statementMinor: 5000,
      appMinor: 5000,
      differenceMinor: 0,
      agrees: true,
    });
  });

  test("gives what the app counts beyond the statement when they disagree", () => {
    const days: Array<string> = [];

    const check = balanceCheck({ day: "2026-10-31", minor: 5000 }, (day) => {
      days.push(day);

      return 4250;
    });

    expect(days).toEqual(["2026-10-31"]);
    expect(check?.differenceMinor).toBe(-750);
    expect(check?.agrees).toBe(false);
  });
});

describe("looksEmpty", () => {
  test("a balance of zero the app's balance contradicts looks empty", () => {
    expect(looksEmpty(0, 182_450)).toBe(true);
    expect(looksEmpty(0, -3210)).toBe(true);
  });

  test("a balance of zero the app's balance agrees with is kept", () => {
    expect(looksEmpty(0, 0)).toBe(false);
  });

  test("a balance other than zero is kept, whatever the app counts", () => {
    fc.assert(
      fc.property(
        anyMinor.filter((minor) => minor !== 0),
        anyMinor,
        (statementMinor, appMinor) => {
          expect(looksEmpty(statementMinor, appMinor)).toBe(false);
        },
      ),
    );
  });

  test("a balance of zero looks empty exactly when the app counts something else", () => {
    fc.assert(
      fc.property(anyMinor, (appMinor) => {
        expect(looksEmpty(0, appMinor)).toBe(appMinor !== 0);
      }),
    );
  });
});
