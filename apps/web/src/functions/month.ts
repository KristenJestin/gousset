import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { devLatency } from "@/lib/dev-latency";
import { usableSession } from "@/lib/session.server";

import { UserCurrency } from "./currency";

/**
 * Only a signed-in user reads data, and only their own: the session says whose, and the currency
 * their months are read in (euros if their account holds no code, as `getViewer` says).
 */
export const signedIn = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { session, refusal } = await usableSession(getRequestHeaders());

  // A temporary password reaches no data: someone else chose it (#70, #79).
  if (session === undefined) {
    throw new Error(refusal === "SIGN_IN_REQUIRED" ? "Sign in to read your data." : refusal);
  }

  const { currency } = session.user;

  return next({
    context: {
      owner: session.user.id,
      currency: Schema.is(UserCurrency)(currency) ? currency : "EUR",
    },
  });
});

/** In development, the latency `GOUSSET_DEV_LATENCY_MS` asks for (`@/lib/dev-latency`). */
export const slowedInDevelopment = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    await Effect.runPromise(devLatency);

    return next();
  },
);
