import { Config, Effect, Option } from "effect";

/**
 * Development only: `GOUSSET_DEV_LATENCY_MS=1200 pnpm dev` makes every data server function wait
 * that long before it answers, to watch the skeletons, the month kept on screen while the next one
 * loads, and the optimistic actions. A production build never waits, whatever the variable says.
 */
export const DEV_LATENCY_VARIABLE = "GOUSSET_DEV_LATENCY_MS";

const latency = Config.option(Config.Int(DEV_LATENCY_VARIABLE));

/** Waits the development latency, when one is set and the app runs in development. */
export const devLatency = Effect.gen(function* () {
  if (!import.meta.env.DEV) {
    return;
  }

  const milliseconds = yield* latency;

  if (Option.isSome(milliseconds) && milliseconds.value > 0) {
    yield* Effect.sleep(milliseconds.value);
  }
});
