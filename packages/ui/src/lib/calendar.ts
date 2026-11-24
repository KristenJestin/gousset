import type { YearMonth } from "./month";

// A month laid out as a calendar: its days in whole weeks, from the week's first day. Dates are
// read on UTC, so the device's timezone never moves a day to the next column.

/** `2026-11` as its year and month. */
export function parseMonth(month: string): YearMonth {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

/** `{ year: 2027, month: 1 }` as `2027-01`. */
export function monthKey(value: YearMonth): string {
  return `${String(value.year)}-${String(value.month).padStart(2, "0")}`;
}

/**
 * The month's days (1 to 31) in weeks of seven, from `weekStartsOn` (0 for Sunday, 1 for Monday):
 * `null` before the first day and after the last, so each day sits in its weekday's column.
 */
export function calendarWeeks(value: YearMonth, weekStartsOn: number): Array<Array<number | null>> {
  const length = new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(value.year, value.month - 1, 1)).getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const count = Math.ceil((lead + length) / 7);

  return Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, column) => {
      const day = week * 7 + column - lead + 1;

      return day >= 1 && day <= length ? day : null;
    }),
  );
}
