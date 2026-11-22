import { Clock, Effect } from "effect";

/**
 * Today, `YYYY-MM-DD`, from Effect's `Clock`: the one place the month logic reads the date, so that
 * a test (or the end-to-end harness's fixed day, #47) can provide a clock of its own. Read in UTC
 * until a user has a time zone of their own.
 */
export const today: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, (now) =>
  new Date(now).toISOString().slice(0, 10),
);

/** Today's month, `YYYY-MM`. */
export const currentMonth: Effect.Effect<string> = Effect.map(today, (day) => day.slice(0, 7));
