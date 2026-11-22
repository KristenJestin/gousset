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

/**
 * The access token's own claim of when it was minted, in milliseconds: `iat` counts in seconds, and
 * a client revoked then allowed again within one second must not see its old token revived.
 */
export const ISSUED_AT_MS_CLAIM = "gousset_iat_ms";

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
  return mcpAddressOf({ BETTER_AUTH_URL: appUrl }).resource;
}

/**
 * The app's origin and its MCP resource, read from the environment when the server runs. The
 * environment is passed whole: written `ENV.BETTER_AUTH_URL` in the app, a public variable is
 * replaced by its build-time value, and the door must follow the address the app is started with.
 */
export type McpAddress = {
  /** The app's origin, from which the door accepts a browser's calls. */
  origin: string;
  /** `/mcp` on it, or none when the address cannot carry the door. */
  resource: string | undefined;
};

export function mcpAddressOf(env: { readonly BETTER_AUTH_URL: string }): McpAddress {
  const appUrl = env.BETTER_AUTH_URL;
  const url = new URL(appUrl);
  const servable = url.protocol === "https:" || isLoopbackHost(url.hostname);

  return { origin: url.origin, resource: servable ? `${url.origin}${MCP_PATH}` : undefined };
}
