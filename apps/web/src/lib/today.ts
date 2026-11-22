import { Clock, Config, Effect, Option, Schema } from "effect";

/**
 * Set to `on` by the end-to-end harness only (`apps/e2e/src/app-server.ts`). An installation never
 * sets it: neither the image, nor docker-compose.yml, nor `.env.schema` names it.
 */
export const E2E_CLOCK_VARIABLE = "GOUSSET_E2E_CLOCK";

/** The cookie `fixDay` sets in the harness (`apps/e2e/src/clock.ts`), read only under the variable. */
export const E2E_DAY_COOKIE = "gousset-e2e-day";

/** A calendar day, `YYYY-MM-DD`. */
const Day = Schema.String.check(
  Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
);

/** Present only when the harness started the app; any value but `on` fails loudly. */
export const e2eClock = Config.option(Config.Literal("on", E2E_CLOCK_VARIABLE));

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Today on the server, in its own time zone: the one day months and expiries are read from. It is
 * the server's clock, unless the harness started the app: then a scenario's `requestedDay` (its
 * cookie) wins. Without the harness's variable, `requestedDay` is ignored whatever it holds.
 */
export const today = (requestedDay: string | undefined) =>
  Effect.gen(function* () {
    const fixed = Option.isSome(yield* e2eClock) ? requestedDay : undefined;

    if (fixed !== undefined) {
      return yield* Schema.decodeUnknownEffect(Day)(fixed);
    }

    return localDay(new Date(yield* Clock.currentTimeMillis));
  });
