import { describe, expect, it } from "vite-plus/test";

import { formatChartDay, monthBars, spendingRows, toChartValue } from "./chart-amounts";

const day = (date: number, current: number | null, previous: number | null) => ({
  date: new Date(2026, 9, date),
  current,
  previous,
});

const month = (year: number, index: number) => ({
  date: new Date(year, index, 1),
  amount: { minor: 1000, currency: "EUR" },
});

describe("chart amounts", () => {
  it("formats a bank day in UTC: a day west of UTC never reads a day earlier", () => {
    // A bank day is parsed as UTC midnight (docs/data-model.md, "Dates"): this `Date` is
    // 2026-10-31 in any zone west of UTC, so a test that relied on the machine's own zone would
    // not reveal the bug `balance-chart.tsx` passing "UTC" fixes.
    const bankDay = new Date("2026-11-01T00:00:00Z");

    expect(formatChartDay(bankDay, "en", "UTC")).toBe("Nov 1");
  });

  it("draws cents as euros, and a currency without minor units as it is", () => {
    expect(toChartValue({ minor: 123_456, currency: "EUR" })).toBe(1234.56);
    expect(toChartValue({ minor: 1500, currency: "JPY" })).toBe(1500);
  });

  it("stops the days at the last one this period has, carrying the period before", () => {
    const rows = spendingRows(
      [day(1, 1000, 500), day(2, 2550, null), day(3, 4000, 1200), day(4, null, 1500)],
      "EUR",
    );

    expect(rows.map((row) => [row.current, row.previous])).toEqual([
      [10, 5],
      [25.5, 5],
      [40, 12],
    ]);
    expect(rows[1]?.currentMinor).toBe(2550);
    expect(rows[1]?.previousMinor).toBe(500);
    expect(spendingRows([day(1, null, 500)], "EUR")).toEqual([]);
  });

  it("names each bar by its short month, with the year once a month comes back", () => {
    expect(monthBars([month(2026, 8), month(2026, 9)], "en").map((bar) => bar.name)).toEqual([
      "Sep",
      "Oct",
    ]);

    // Thirteen months, October twice: every name stays unique, so no two bars share a band.
    const year = Array.from({ length: 13 }, (_, index) => month(2025, 9 + index));
    const names = monthBars(year, "en").map((bar) => bar.name);

    expect(new Set(names).size).toBe(13);
    expect(names[0]).toBe("Oct 25");
    expect(names[12]).toBe("Oct 26");
  });
});
