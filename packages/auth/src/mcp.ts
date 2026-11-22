import { isLoopbackHost } from "@better-auth/core/utils/host";

/**
 * The two scopes a user chooses between on the consent page (docs/mcp.md, "Authorization and
 * scopes"): read only, or read and write. `offline_access` only lets a client refresh its token.
 */
export const McpScope = {
  read: "read",
  write: "write",
} as const;

export type McpScope = (typeof McpScope)[keyof typeof McpScope];

export const MCP_SCOPES = [McpScope.read, McpScope.write] as const;

/** The path of the MCP door in the app. */
export const MCP_PATH = "/mcp";

/** Where the consent page and the sign-in page live, for the authorization flow. */
export const CONSENT_PATH = "/consent";
export const SIGN_IN_PATH = "/sign-in";

/**
 * The MCP door's resource identifier (RFC 8707), to which every token is bound: `/mcp` on the
 * app's own address. `undefined` when the address can carry no MCP resource: MCP authorization
 * needs HTTPS, or a loopback address for a local installation, so an installation served over
 * plain HTTP on a network address has no door.
 */
export function mcpResourceOf(appUrl: string): string | undefined {
  const url = new URL(appUrl);
  const servable = url.protocol === "https:" || isLoopbackHost(url.hostname);

  return servable ? `${url.origin}${MCP_PATH}` : undefined;
}
