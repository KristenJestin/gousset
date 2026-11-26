import { Schema } from "effect";

import { calendarDay, fullYear } from "./dates";

// An import profile's definition: how to read one bank's CSV export. The database stores it whole
// as `import_profile.definition` (docs/data-model.md, "Import profiles"), beside its name, its
// institution and its kind; this schema is the only place that knows its shape, and the same JSON
// is the file a user exports to share a profile. `version` lets a later schema read this shape.

/** A column of the file, counted from 1, as the preview and the errors number them. */
export const Column = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * A day as the bank writes it: `DD`, `MM` and `YYYY` or `YY`, in the order day, month, year or
 * month, day, year or year, month, day, separated by `/`, `.`, `-`, a space, or nothing
 * (`DD/MM/YYYY`, `MM/DD/YY`, `YYYY-MM-DD`, `DD.MM.YYYY`, `YYYYMMDD`).
 */
const DATE_FORMAT =
  /^(?:DD([/. -]?)MM\1(?:YYYY|YY)|MM([/. -]?)DD\2(?:YYYY|YY)|YYYY([/. -]?)MM\3DD)$/;

export const DateFormat = Schema.String.check(Schema.isPattern(DATE_FORMAT));

/**
 * Where the amount is. `signed`: one column, negative for money out. `debit-credit`: money out in
 * one column and money in in another, each line filling one of them; the debit column's sign is
 * the bank's habit (`23,90` or `-23,90`), the same on every line, and money goes out either way.
 */
const AmountColumns = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("signed"), column: Column }),
  Schema.Struct({ kind: Schema.Literal("debit-credit"), debit: Column, credit: Column }),
]);

/**
 * The most lines a profile skips above its table: a bank writes a few (an account's name, a
 * period), and blank lines need no skipping. It bounds what a header search scans.
 */
export const MAX_SKIP_ROWS = 100;

/** An import profile's definition, version 1. */
export const CsvProfile = Schema.Struct({
  version: Schema.Literal(1),
  /** What separates the values of a row. A value holding it is quoted (`"A; B"`). */
  separator: Schema.Literals([";", ",", "\t", "|"]),
  /**
   * The file's encoding: a byte order mark is dropped either way, and bytes that are not UTF-8
   * in a file said to be are refused. Windows-1252 also reads Latin-1.
   */
  encoding: Schema.Literals(["utf8", "windows-1252"]),
  /** The file's first lines, read past before the header: the account's name, the period. */
  skipRows: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(MAX_SKIP_ROWS),
  ),
  /** Whether the first row after them names the columns, rather than holding a line. */
  headerRow: Schema.Boolean,
  dateFormat: DateFormat,
  /** Every other mark groups thousands, by three digits (`1 234,56`, `1,234.56`). */
  decimalMark: Schema.Literals([".", ","]),
  /** Which column holds which field of a line (`StatementLine`); `null` where none does. */
  columns: Schema.Struct({
    bookedOn: Column,
    valueOn: Schema.NullOr(Column),
    amount: AmountColumns,
    label: Column,
    memo: Schema.NullOr(Column),
    bankId: Schema.NullOr(Column),
    /** The line's currency code, checked against the account's; a line in another is refused. */
    currency: Schema.NullOr(Column),
  }),
  /**
   * A table that is not one line per row, and how to read it, when its rows need more than columns
   * (README, "PayPal's activity"): `paypal-activity` finds PayPal's columns by their names, keeps
   * the rows that moved the balance in the account's currency, and reads its days and amounts as
   * the file writes them. Left out for a plain table.
   */
  layout: Schema.optionalKey(Schema.Literal("paypal-activity")),
});

export type CsvProfile = typeof CsvProfile.Type;

/** A table read otherwise than one line per row (`CsvProfile.layout`). */
export type CsvLayout = NonNullable<CsvProfile["layout"]>;

/** The highest column a profile reads: a header with fewer is another file's. */
export function lastColumn(profile: CsvProfile): number {
  const { amount, ...others } = profile.columns;

  const amounts = amount.kind === "signed" ? [amount.column] : [amount.debit, amount.credit];

  return Math.max(...amounts, ...Object.values(others).filter((column) => column !== null));
}

/** A day of the calendar, `YYYY-MM-DD`, from its text; `undefined` when it is none. */
export type DayReader = (text: string) => string | undefined;

/** The reader of a profile's date format: `DD/MM/YYYY` reads `03/10/2026` and `3/10/2026`. */
export function dayReader(format: string): DayReader {
  const yearDigits = format.includes("YYYY") ? 4 : 2;
  const separator = /^(?:YYYY|DD|MM)([^DMY]?)/.exec(format)?.[1] ?? "";
  const number = separator === "" ? String.raw`(\d{2})` : String.raw`(\d{1,2})`;
  const year = String.raw`(\d{${String(yearDigits)}})`;
  const between = separator.replace(/[.-]/, String.raw`\$&`);
  const yearFirst = format.startsWith("Y");

  const pattern = new RegExp(
    `^${(yearFirst ? [year, number, number] : [number, number, year]).join(between)}$`,
  );

  return (text) => {
    const parts = pattern.exec(text.trim());

    if (parts === null) {
      return undefined;
    }

    const [, first = "", second = "", third = ""] = parts;
    const written = yearFirst ? Number(first) : Number(third);
    const fullYearOf = yearDigits === 4 ? written : fullYear(written, false);

    if (yearFirst) {
      return calendarDay(fullYearOf, Number(second), Number(third));
    }

    return format.startsWith("DD")
      ? calendarDay(fullYearOf, Number(second), Number(first))
      : calendarDay(fullYearOf, Number(first), Number(second));
  };
}

/** The format with a day in it, for an error to show: `DD/MM/YYYY` is `03/10/2026`. */
export function dateExample(format: string): string {
  return format.replace("YYYY", "2026").replace("YY", "26").replace("MM", "10").replace("DD", "03");
}
