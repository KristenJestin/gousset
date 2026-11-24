import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { authInfoOf, createMcpEndpoint } from "./server";
import type { ServerDefinition, ServerRuntime } from "./server";
import type { Caller } from "./tool";

export type Revision = "2025-11-25" | "2026-07-28";

/**
 * The official MCP client, connected over Streamable HTTP to the endpoint the door serves, without
 * a network: the client's requests go straight to the endpoint's handler, as `caller`. For the
 * package's tests; the end-to-end tests go through the built app and OAuth.
 */
export async function connectInProcess<R>(
  definition: ServerDefinition<R>,
  runtime: ServerRuntime<R>,
  caller: Caller,
  revision: Revision,
): Promise<Client> {
  const endpoint = createMcpEndpoint(definition, runtime);

  const transport = new StreamableHTTPClientTransport(new URL("http://gousset.test/mcp"), {
    fetch: (input, init) =>
      endpoint(new Request(input, init), authInfoOf(caller, "test-token", "test-client")),
  });

  const client = new Client(
    { name: "gousset-test", version: "0.0.0" },
    revision === "2026-07-28" ? { versionNegotiation: { mode: { pin: revision } } } : {},
  );

  await client.connect(transport);

  return client;
}

/** The text of a tool's result, and whether it is an error. */
export async function callText(
  client: Client,
  name: string,
  args: { [key: string]: string | number },
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}
