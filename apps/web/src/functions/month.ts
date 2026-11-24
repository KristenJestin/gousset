import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { devLatency } from "@/lib/dev-latency";
import { usableSession } from "@/lib/session.server";

/** Only a signed-in user reads data, and only their own: the session says whose. */
export const signedIn = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { session, refusal } = await usableSession(getRequestHeaders());

  // A temporary password reaches no data: someone else chose it (#70, #79).
  if (session === undefined) {
    throw new Error(refusal === "SIGN_IN_REQUIRED" ? "Sign in to read your data." : refusal);
  }

  return next({ context: { owner: session.user.id } });
});

/** In development, the latency `GOUSSET_DEV_LATENCY_MS` asks for (`@/lib/dev-latency`). */
export const slowedInDevelopment = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    await Effect.runPromise(devLatency);

    return next();
  },
);
