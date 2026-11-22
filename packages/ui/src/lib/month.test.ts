import { describe, expect, test } from "vite-plus/test";

import { addMonths, formatMonth, monthIndex, monthOf } from "./month";

describe("addMonths", () => {
  test("steps within a year and across its ends", () => {
    expect(addMonths({ year: 2026, month: 10 }, 1)).toEqual({ year: 2026, month: 11 });
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 });
  });

  test("orders months as numbers", () => {
    expect(monthIndex({ year: 2026, month: 1 })).toBeGreaterThan(
      monthIndex({ year: 2025, month: 12 }),
    );
  });
});

describe("monthOf and formatMonth", () => {
  test("read a date's month and say it in a language", () => {
    expect(monthOf(new Date(2026, 9, 24))).toEqual({ year: 2026, month: 10 });
    expect(formatMonth({ year: 2026, month: 10 }, "en")).toBe("October 2026");
    expect(formatMonth({ year: 2026, month: 10 }, "fr")).toBe("octobre 2026");
  });
});
