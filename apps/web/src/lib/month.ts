import type { YearMonth } from "@gousset/ui/lib/month";
import { Effect, Option, Schema } from "effect";

/** A month of a year, `YYYY-MM`: how the URL and the server name it. */
export const Month = Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/));

/**
 * The search of a month's screen (the review, the operations): `?month=2026-10`. Absent, it is
 * the current month; a month that cannot be read is dropped the same way rather than failing the
 * page, since anyone may type an address.
 */
export const monthSearch = Schema.toStandardSchemaV1(
  Schema.Struct({
    month: Schema.optional(
      Schema.UndefinedOr(Month).pipe(
        Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))),
      ),
    ),
  }),
);

/** `2026-10` as the month switcher takes it: `{ year: 2026, month: 10 }`. */
export function toYearMonth(month: string): YearMonth {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

/** `{ year: 2026, month: 10 }` as the URL names it: `2026-10`. */
export function fromYearMonth(value: YearMonth): string {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}`;
}

/** The month a day (`YYYY-MM-DD`) falls in. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}
