// The data as the charts draw it. Money arrives as integer minor units; a chart places major
// units (a float is fine for a position on screen), and every text formats the minor units with
// `formatMoney`, so no float drift is ever shown.

import type { Money } from "./money";
import { minorDigits } from "./money";

/** Where the amount sits on the chart's value axis, in major units. */
export function toChartValue(money: Money) {
  return money.minor / 10 ** minorDigits(money.currency);
}

/** One day of spending as a page gives it: cumulative, in minor units, `null` where it has none. */
export type SpendingDay = { date: Date; current: number | null; previous: number | null };

/** One day as the spending chart draws it: major units for the lines, minor units for the texts. */
export type SpendingRow = {
  date: Date;
  current: number;
  previous: number;
  currentMinor: number;
  previousMinor: number;
};

/**
 * The days the spending chart draws: up to the last day this period has (its lines cannot skip a
 * missing value, they would fall to zero), each missing amount carried from the day before, which
 * is what a cumulative total is (the period before has no 31st: its total stays).
 */
export function spendingRows(
  days: ReadonlyArray<SpendingDay>,
  currency: string,
): Array<SpendingRow> {
  const scale = 10 ** minorDigits(currency);
  const last = days.findLastIndex((day) => day.current !== null);
  let current = 0;
  let previous = 0;

  return days.slice(0, last + 1).map((day) => {
    current = day.current ?? current;
    previous = day.previous ?? previous;

    return {
      date: day.date,
      current: current / scale,
      previous: previous / scale,
      currentMinor: current,
      previousMinor: previous,
    };
  });
}

/** One bar as a page gives it: a month and what it holds. */
export type MonthAmount = { date: Date; amount: Money };

/** One bar as the bar chart draws it: its label, its height in major units, its amount. */
export type MonthBar = { name: string; value: number; amount: Money };

/**
 * The bars, each named by its short month in the page's language, and by its year too once a
 * month comes back (thirteen months, two Octobers): the chart places its bars by name, and two
 * bars with one name would share one place.
 */
export function monthBars(months: ReadonlyArray<MonthAmount>, locale: string): Array<MonthBar> {
  const short = months.map((month) => formatChartMonth(month.date, locale));
  const withYear = new Set(short).size < short.length;

  return months.map((month, index) => ({
    name: withYear
      ? new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }).format(month.date)
      : (short[index] ?? ""),
    value: toChartValue(month.amount),
    amount: month.amount,
  }));
}

/** A day under the chart: "Oct 3", "3 oct.". */
export function formatChartDay(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
}

/** A month under a bar: "Oct", "oct.". */
export function formatChartMonth(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
}
