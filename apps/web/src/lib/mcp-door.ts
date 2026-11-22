import { mcpAddressOf } from "@gousset/auth/mcp";
import { isMcpDoorOpen } from "@gousset/auth/mcp-door";

import { ENV } from "../env.server";
import { db } from "../services";

/**
 * The app's origin and `/mcp` on it, as the app was started: no resource when it is served over
 * plain HTTP on a network address. `ENV` is passed whole (see `mcpAddressOf`).
 */
export const mcpAddress = mcpAddressOf(ENV);

export const mcpResource = mcpAddress.resource;

/**
 * Whether the MCP door is open now: the app's address can carry it and the administrator has not
 * closed it. Closed, `/mcp`, its metadata and the authorization endpoints answer 404.
 */
export async function isDoorOpen(): Promise<boolean> {
  return mcpResource !== undefined && (await isMcpDoorOpen(db));
}

export const notFound = () => new Response("Not Found", { status: 404 });
