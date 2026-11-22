import { MCP_SCOPES, McpScope } from "@gousset/auth/mcp";
import { isClientAllowed, requireMcpAuth } from "@gousset/auth/mcp-door";
import { goussetServer } from "@gousset/mcp/gousset";
import { authInfoOf, createMcpEndpoint } from "@gousset/mcp/server";
import { createFileRoute } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { isDoorOpen, mcpAddress, mcpResource, notFound } from "../lib/mcp-door";
import { auth, db, runtime } from "../services";

const endpoint = createMcpEndpoint(goussetServer, {
  run: (effect) => runtime.runPromiseExit(effect),
});

/** What the door reads of a verified access token. */
const AccessClaims = Schema.Struct({
  sub: Schema.String,
  azp: Schema.String,
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

      // A signed token stays valid until it expires: the consent is read on every call, so that
      // revoking a client in the settings shuts it out at once.
      if (!(await isClientAllowed(db, userId, clientId))) {
        return revoked(resource);
      }

      const canWrite = scope.split(" ").includes(McpScope.write);
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /i, "");

      return endpoint(request, authInfoOf({ userId, canWrite }, token, clientId));
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
