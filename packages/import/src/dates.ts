const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM-DD` for a day of the calendar; `undefined` when there is no such day (`2026-02-30`). */
export function calendarDay(year: number, month: number, day: number): string | undefined {
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];

  if (days === undefined || year < 1 || day < 1 || day > days) {
    return undefined;
  }

  return `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`;
}

/**
 * An OFX date, `YYYYMMDD`, maybe followed by a time (`HHMM`, `HHMMSS`, `HHMMSS.XXX`) and a time zone
 * (`[+1:CET]`, `[-5]`).
 */
const OFX_DATE =
  /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2})(?:\.\d{1,3})?)?)?\s*(?:\[[^\]]*\])?$/;

/**
 * The day an OFX date names, as the bank wrote it. The time and the zone are checked, then read
 * past: moving the day to another zone would book a line on a day the bank never showed.
 */
export function ofxDay(text: string): string | undefined {
  const parts = OFX_DATE.exec(text.trim());

  if (parts === null) {
    return undefined;
  }

  const [, year = "", month = "", day = "", hours = "0", minutes = "0", seconds = "0"] = parts;

  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 60) {
    return undefined;
  }

  return calendarDay(Number(year), Number(month), Number(day));
}

/** Which of a QIF date's two first numbers is the day. */
export type DateOrder = "day-first" | "month-first";

/**
 * A QIF date as written: a whole ISO day, or two numbers and a year whose order the file decides
 * (`03/04/2026` is the third of April in France, the fourth of March in the United States).
 */
export type QifDate =
  | { kind: "iso"; day: string }
  | { kind: "numbers"; first: number; second: number; year: number };

/**
 * Two digits of a year. Quicken writes `'` before the years from 2000 (`1/ 5'26`); with any other
 * separator, `00` to `69` are read as 2000 to 2069 and `70` to `99` as 1970 to 1999.
 */
export function fullYear(twoDigitYear: number, apostrophe: boolean): number {
  return apostrophe || twoDigitYear < 70 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
}

/**
 * A QIF `D` field: `2026-10-03`, or day and month in either order separated by `/`, `.` or `-`,
 * then a year of two or four digits (`03/10/2026`, `10/3/26`, `03.10.2026`, `10/ 3'26`). Spaces
 * stand in for leading zeros in Quicken's files and are dropped.
 */
export function readQifDate(text: string): QifDate | undefined {
  const compact = text.replaceAll(" ", "");
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(compact);

  if (iso !== null) {
    const [, year = "", month = "", date = ""] = iso;
    const day = calendarDay(Number(year), Number(month), Number(date));

    return day === undefined ? undefined : { kind: "iso", day };
  }

  const parts = /^(\d{1,2})[/.-](\d{1,2})([/.\-'])(\d{2}|\d{4})$/.exec(compact);

  if (parts === null) {
    return undefined;
  }

  const [, first = "", second = "", separator = "", year = ""] = parts;

  return {
    kind: "numbers",
    first: Number(first),
    second: Number(second),
    year: year.length === 4 ? Number(year) : fullYear(Number(year), separator === "'"),
  };
}

/** The day a QIF date names, its numbers read in `order`; `undefined` when there is no such day. */
export function qifDay(date: QifDate, order: DateOrder): string | undefined {
  if (date.kind === "iso") {
    return date.day;
  }

  return order === "day-first"
    ? calendarDay(date.year, date.second, date.first)
    : calendarDay(date.year, date.first, date.second);
}
