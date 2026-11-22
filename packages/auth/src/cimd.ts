import type { CimdOptions } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";

/**
 * How Gousset reads a Client ID Metadata Document (docs/mcp.md, "Authorization and scopes"): with
 * the MCP 2026-07-28 profile, which requires `client_name` and `redirect_uris`, through the
 * transport that resolves the host once, refuses private, loopback and special addresses, pins
 * the connection and follows no redirect. Never loosened, not even for tests: the end-to-end
 * harness pre-registers its client instead.
 */
export const cimdOptions = {
  fetchClientMetadataResource,
  metadataProfile: "mcp-2026-07-28",
} satisfies CimdOptions;
