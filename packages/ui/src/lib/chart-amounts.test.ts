import { describe, expect, it } from "vite-plus/test";

import { spendingRows, toChartValue } from "./chart-amounts";

const day = (date: number, current: number | null, previous: number | null) => ({
  date: new Date(2026, 9, date),
  current,
  previous,
});

describe("chart amounts", () => {
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
});
