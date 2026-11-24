import { ISSUED_AT_MS_CLAIM, MCP_SCOPES, McpScope } from "@gousset/auth/mcp";
import { currentGrant, requireMcpAuth } from "@gousset/auth/mcp-door";
import { goussetServer } from "@gousset/mcp/gousset";
import { authInfoOf, createMcpEndpoint } from "@gousset/mcp/server";
import { E2E_PROBE_VARIABLE, e2eProbeTool } from "@gousset/mcp/tools/e2e-probe";
import { createFileRoute } from "@tanstack/react-router";
import { Config, Effect, Option, Schema } from "effect";

import { isDoorOpen, mcpAddress, mcpResource, notFound } from "../lib/mcp-door";
import { mcpCallObserver } from "../lib/mcp-telemetry";
import { auth, db, runCore } from "../services";
import { telemetry } from "../telemetry.server";

/** Present only when the end-to-end harness started the app; any value but `on` fails loudly. */
const e2eProbe = Effect.runSync(
  Effect.gen(function* () {
    return yield* Config.option(Config.Literal("on", E2E_PROBE_VARIABLE));
  }),
);

/** Gousset's tools; under the harness, its test-only write action after them. */
const served = Option.isSome(e2eProbe)
  ? { ...goussetServer, tools: [...goussetServer.tools, e2eProbeTool] }
  : goussetServer;

const endpoint = createMcpEndpoint(served, {
  // The same runtime and `today` as the server functions (`runCore`).
  run: (effect) => runCore(Effect.exit(effect)),
  // A span per call, under the request's (docs/mcp.md, rule 16).
  observe: mcpCallObserver((effect) => telemetry.runPromise(effect)),
});

/** What the door reads of a verified access token. */
const AccessClaims = Schema.Struct({
  sub: Schema.String,
  azp: Schema.String,
  [ISSUED_AT_MS_CLAIM]: Schema.Number,
  scope: Schema.optional(Schema.String),
});

const claimsOf = Schema.decodeUnknownOption(AccessClaims);

/** A token whose client the user revoked: the client is told to authorize again. */
function revoked(resource: string) {
  const metadata = new URL(resource);

  metadata.pathname = `/.well-known/oauth-protected-resource${metadata.pathname}`;

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_000, message: "This client was revoked: authorize it again." },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer error="invalid_token", error_description="The client was revoked", resource_metadata="${metadata.toString()}", scope="${MCP_SCOPES.join(" ")}"`,
      },
    },
  );
}

/**
 * Verifies the bearer token (signed by Gousset, unexpired, bound to this resource: a token for
 * another resource is refused), then checks the user still allows the client, then serves MCP.
 */
function protect(resource: string) {
  return requireMcpAuth(
    auth,
    async (request, accessClaims) => {
      const claims = claimsOf(accessClaims);

      if (Option.isNone(claims)) {
        return revoked(resource);
      }

      const { sub: userId, azp: clientId, scope = "" } = claims.value;
      const issuedAt = claims.value[ISSUED_AT_MS_CLAIM];

      // A signed token stays valid until it expires: the grant is read on every call, so that
      // revoking a client (or banning its user) shuts it out at once, and a token issued before
      // the current consent (an older one, revoked since) is never revived by it.
      const grant = await currentGrant(db, userId, clientId);

      if (
        grant === undefined ||
        issuedAt < grant.since.getTime() ||
        (grant.revokedUntil !== undefined && issuedAt <= grant.revokedUntil.getTime())
      ) {
        return revoked(resource);
      }

      // Write needs both: the token was issued with it, and the user still allows it.
      const canWrite =
        scope.split(" ").includes(McpScope.write) && grant.scopes.includes(McpScope.write);

      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /i, "");

      return endpoint(
        request,
        authInfoOf(
          { userId, canWrite, grantId: grant.id, origin: mcpAddress.origin },
          token,
          clientId,
        ),
      );
    },
    { resource, challengeScopes: MCP_SCOPES },
  );
}

const verified = mcpResource === undefined ? undefined : protect(mcpResource);

/**
 * The MCP door (docs/mcp.md). Closed, it answers 404 like any unknown page: the administrator
 * turned it off, or the app's address cannot carry it. A page of another site may not call it:
 * MCP clients send no `Origin`, or the app's own.
 */
async function handle(request: Request) {
  if (verified === undefined || !(await isDoorOpen())) {
    return notFound();
  }

  const origin = request.headers.get("origin");

  if (origin !== null && origin !== mcpAddress.origin) {
    return new Response("Forbidden", { status: 403 });
  }

  return verified(request);
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
    },
  },
});
