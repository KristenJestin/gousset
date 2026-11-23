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
