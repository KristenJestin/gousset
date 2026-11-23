import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { Option, Schema } from "effect";

import { unobserved } from "./tool";
import type { CallObserver, Caller, Runner, Tool } from "./tool";

/** The server's own name, as clients show it. */
export const SERVER_NAME = "gousset";

/** What the server serves: its tools, in order, and its instructions. */
export type ServerDefinition<R> = {
  readonly tools: ReadonlyArray<Tool<R>>;
  readonly instructions: string;
  readonly version: string;
};

/** How the server runs: the services its tools need, and the observer of each call. */
export type ServerRuntime<R> = {
  readonly run: Runner<R>;
  readonly observe?: CallObserver;
};

/**
 * One server instance for one caller: every tool, in the given order (the listing's order, the
 * same for both protocol revisions), and the instructions. No roots, sampling, logging nor
 * elicitation (docs/mcp.md, rule 10): only tools are declared.
 */
export function createServer<R>(
  definition: ServerDefinition<R>,
  runtime: ServerRuntime<R>,
  caller: Caller,
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: definition.version },
    { instructions: definition.instructions, capabilities: { tools: {} } },
  );

  for (const tool of definition.tools) {
    tool.register(server, caller, runtime.observe ?? unobserved, runtime.run);
  }

  return server;
}

/** What the door puts in `AuthInfo.extra` for the server it builds. */
const CallerExtra = Schema.Struct({
  userId: Schema.String,
  canWrite: Schema.Boolean,
  currency: Schema.String,
});

const callerOf = Schema.decodeUnknownOption(CallerExtra);

/** The verified caller, in the form the SDK carries it from the door to the server. */
export function authInfoOf(caller: Caller, token: string, clientId: string): AuthInfo {
  return {
    token,
    clientId,
    scopes: caller.canWrite ? ["read", "write"] : ["read"],
    extra: { userId: caller.userId, canWrite: caller.canWrite, currency: caller.currency },
  };
}

/**
 * The MCP endpoint's handler: Streamable HTTP, the 2026-07-28 revision (stateless, with
 * `server/discover`) and the 2025-11-25 one (`initialize`, served statelessly), from one factory,
 * so both revisions list the same tools in the same order. It verifies nothing itself: the door
 * gives it the caller it verified, and a request without one gets no server.
 */
export function createMcpEndpoint<R>(definition: ServerDefinition<R>, runtime: ServerRuntime<R>) {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const caller = callerOf(authInfo?.extra);

      if (Option.isNone(caller)) {
        throw new Error("The MCP door verifies the caller before the server is built.");
      }

      return createServer(definition, runtime, caller.value);
    },
    { legacy: "stateless" },
  );

  return (request: Request, authInfo: AuthInfo) => handler.fetch(request, { authInfo });
}
