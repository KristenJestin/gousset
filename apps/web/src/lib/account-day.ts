// A day (`YYYY-MM-DD`) worded for the accounts pages, in the page's language.

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

// A bank day has no time zone (docs/data-model.md, "Dates"): parsed as UTC midnight above, it is
// formatted in UTC too, or a reader west of the bank would see the day before.

/** "31 Oct.": a statement's day, a line's day. */
export function shortDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(asDate(day));
}

/**
 * `shortDay` for many days at once, as the operations' rows need: one formatter, built once, since
 * building one is slow.
 */
export function shortDays(locale: string): (day: string) => string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (day) => format.format(asDate(day));
}

/** "1–31 Oct 2026": a statement's period, from its first day to its last. */
export function dayRange(from: string, to: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(asDate(from), asDate(to));
}

/** "31 October 2026": an account's settings, a close confirmation. */
export function longDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(asDate(day));
}

/** "October": the month `in`/`out` cover on an account's page. */
export function monthLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(asDate(day));
}
