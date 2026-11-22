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

/** The month a day (`YYYY-MM-DD`) falls in. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}
