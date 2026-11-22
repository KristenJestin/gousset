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

import { forgetUnallowedClients } from "@gousset/auth/mcp-door";
import { createRequestLimit } from "@gousset/auth/mcp-guards";

import { ENV } from "../../../env.server";
import { isDoorOpen, notFound } from "../../../lib/mcp-door";
import { auth, db } from "../../../services";

const trustedProxies = (ENV.TRUSTED_PROXIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");

const shouldWarnIgnoredForward = createIgnoredForwardWarning();

/** Attempts at a password, signing in or changing it, counted in this process. */
const passwordAttempts = createSignInLimits();

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Authorization requests per client address: each may make the server fetch a client's metadata
 * document and write a client, before anyone signs in. A person connecting agents makes a few.
 */
const authorizeRequests = createRequestLimit(30, MINUTE);

let lastClientCleanup = 0;

/**
 * Forgets, at most once an hour, the clients that came by their metadata document a day ago or
 * more and that nobody allowed: anyone can make one exist by starting an authorization.
 */
async function forgetUnallowedClientsNow(now: number) {
  if (now - lastClientCleanup < HOUR) {
    return;
  }

  lastClientCleanup = now;
  await forgetUnallowedClients(db, new Date(now - 24 * HOUR));
}

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

  // The OAuth endpoints exist for the MCP door only: they close with it.
  if (path.startsWith("/api/auth/oauth2/") && !(await isDoorOpen())) {
    return notFound();
  }

  if (path === AUTHORIZE_PATH) {
    const now = Date.now();

    // An address the app could not read counts with every other one like it.
    if (!authorizeRequests.admit(address ?? "unknown", now)) {
      return new Response("Too many authorization requests: try again in a minute.", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }

    await forgetUnallowedClientsNow(now);
  }

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
