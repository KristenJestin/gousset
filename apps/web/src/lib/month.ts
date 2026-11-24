import { Schema } from "effect";

/** A month of a year, `YYYY-MM`: how the URL and the server name it. */
export const Month = Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/));

/** The month a day (`YYYY-MM-DD`) falls in. */
export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}
