import {
  createIgnoredForwardWarning,
  createSignInLimits,
  guardAttempt,
  resolveClientAddress,
  withClientAddress,
} from "@gousset/auth";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestIP } from "@tanstack/react-start/server";
import { Effect, Option, Schema } from "effect";

import { ENV } from "../../../env.server";
import { auth } from "../../../services";

const trustedProxies = (ENV.TRUSTED_PROXIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");

const shouldWarnIgnoredForward = createIgnoredForwardWarning();

/** Attempts at a password, signing in or changing it, counted in this process. */
const passwordAttempts = createSignInLimits();

const emailOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ email: Schema.String })),
);

const refusalCodeOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String })),
);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A wrong current password, as better-auth answers it on /change-password. */
async function isWrongCurrentPassword(response: Response) {
  if (response.status !== 400) {
    return false;
  }

  const refusal = refusalCodeOf(await response.clone().text());

  return Option.isSome(refusal) && refusal.value.code === "INVALID_PASSWORD";
}

/**
 * better-auth, given the client's address as the app resolved it from the connection. Signing in
 * and changing a password go through the attempt limits, keyed on the e-mail tried or on the
 * signed-in user.
 */
async function handle(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (shouldWarnIgnoredForward(forwardedFor, trustedProxies)) {
    Effect.runSync(
      Effect.logWarning(
        "A request carries X-Forwarded-For, but TRUSTED_PROXIES is empty: it is ignored, and failed sign-ins are counted against the connection's address. Behind a reverse proxy, set TRUSTED_PROXIES to its address.",
      ),
    );
  }

  const address = resolveClientAddress(getRequestIP(), forwardedFor, trustedProxies);
  const authRequest = await withClientAddress(request, address);
  const path = new URL(request.url).pathname;
  const run = () => auth.handler(authRequest);
  const attempt = { address, now: Date.now, sleep };

  if (request.method === "POST" && path === "/api/auth/sign-in/email") {
    const body = emailOf(await authRequest.clone().text());

    if (Option.isSome(body)) {
      return guardAttempt(passwordAttempts, { ...attempt, account: body.value.email }, run, (r) =>
        Promise.resolve(r.status === 401),
      );
    }
  }

  if (request.method === "POST" && path === "/api/auth/change-password") {
    const session = await auth.api.getSession({ headers: authRequest.headers });

    if (session) {
      return guardAttempt(
        passwordAttempts,
        { ...attempt, account: `user:${session.user.id}` },
        run,
        isWrongCurrentPassword,
      );
    }
  }

  return run();
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
