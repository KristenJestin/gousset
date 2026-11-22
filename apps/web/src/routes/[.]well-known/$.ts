import { createFileRoute } from "@tanstack/react-router";

import { isDoorOpen, notFound } from "../../lib/mcp-door";
import { auth } from "../../services";

/**
 * The OAuth discovery documents of the MCP door, which better-auth serves: the protected resource
 * metadata (RFC 9728) that a 401 from `/mcp` points to, and the authorization server's metadata.
 * The app publishes nothing else here; with the door closed, none of them exists.
 */
async function handle(request: Request) {
  if (!(await isDoorOpen())) {
    return notFound();
  }

  return auth.handler(request);
}

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
