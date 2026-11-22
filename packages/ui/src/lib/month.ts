/** A month of a year: `month` from 1 (January) to 12. */
export type YearMonth = { year: number; month: number };

/** Months counted from year 0, so two months compare and step as plain numbers. */
export function monthIndex(value: YearMonth): number {
  return value.year * 12 + value.month - 1;
}

/** The month `steps` months after `value` (before it when negative). */
export function addMonths(value: YearMonth, steps: number): YearMonth {
  const index = monthIndex(value) + steps;

  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The month a date falls in, on the device's clock. */
export function monthOf(date: Date): YearMonth {
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** "October 2026", "octobre 2026": the month and year in the given language. */
export function formatMonth(value: YearMonth, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
    new Date(value.year, value.month - 1, 1),
  );
}
