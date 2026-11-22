import { Clock, Context, Effect } from "effect";

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Where the month logic reads today from: the one place. By default the day of Effect's `Clock`,
 * in the server's time zone; the web app provides its own per request (`apps/web/src/lib/today.ts`,
 * which the end-to-end harness can fix), and a test can provide a `TestClock`.
 */
export const Today = Context.Reference<{ readonly day: Effect.Effect<string> }>(
  "@gousset/core/Today",
  {
    defaultValue: () => ({
      day: Effect.map(Clock.currentTimeMillis, (now) => localDay(new Date(now))),
    }),
  },
);

/** Today, `YYYY-MM-DD`. */
export const today: Effect.Effect<string> = Effect.flatMap(Today, (source) => source.day);

/** Today's month, `YYYY-MM`. */
export const currentMonth: Effect.Effect<string> = Effect.map(today, (day) => day.slice(0, 7));
