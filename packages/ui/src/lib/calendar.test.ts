import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import { calendarWeeks, monthKey, parseMonth } from "./calendar";

describe("parseMonth and monthKey", () => {
  it("read and write a month as YYYY-MM", () => {
    expect(parseMonth("2026-11")).toEqual({ year: 2026, month: 11 });
    expect(monthKey({ year: 2027, month: 1 })).toBe("2027-01");
  });
});

describe("calendarWeeks", () => {
  it("starts November 2026 on a Sunday, its first day", () => {
    // 1 November 2026 is a Sunday.
    expect(calendarWeeks({ year: 2026, month: 11 }, 0)).toEqual([
      [1, 2, 3, 4, 5, 6, 7],
      [8, 9, 10, 11, 12, 13, 14],
      [15, 16, 17, 18, 19, 20, 21],
      [22, 23, 24, 25, 26, 27, 28],
      [29, 30, null, null, null, null, null],
    ]);
  });

  it("puts that Sunday last when the week starts on Monday", () => {
    const weeks = calendarWeeks({ year: 2026, month: 11 }, 1);

    expect(weeks[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(weeks.at(-1)).toEqual([30, null, null, null, null, null, null]);
  });

  it("holds every day of any month once, in order, in whole weeks", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2200 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(0, 1),
        (year, month, weekStartsOn) => {
          const weeks = calendarWeeks({ year, month }, weekStartsOn);
          const days = weeks.flat().filter((day) => day !== null);
          const length = new Date(Date.UTC(year, month, 0)).getUTCDate();

          expect(weeks.every((week) => week.length === 7)).toBe(true);
          expect(days).toEqual(Array.from({ length }, (_, index) => index + 1));
          // No week is all blanks.
          expect(weeks.every((week) => week.some((day) => day !== null))).toBe(true);
          // The first day sits in its weekday's column.
          const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

          expect(weeks[0]?.indexOf(1)).toBe((first - weekStartsOn + 7) % 7);
        },
      ),
    );
  });
});
