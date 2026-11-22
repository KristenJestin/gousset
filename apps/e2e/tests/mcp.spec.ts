import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { connectMcp, expect, test } from "../src/test";
import type { McpSession } from "../src/test";

// The scenarios of issue #39, "How to verify", one test each, through the official MCP client and
// the real OAuth flow, plus the door's own rules: revocation at once, the administrator's switch.

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of the `month` tool's answer, and whether it is an error. */
async function askMonth(session: McpSession, month: string) {
  const result = await session.client.callTool({
    name: "month",
    arguments: { action: "summary", month },
  });

  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "no-token", version: "0.0.0" },
  },
};

const JSON_RPC = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** What a client reads of the protected resource metadata (RFC 9728). */
const ResourceMetadata = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.NonEmptyArray(Schema.String),
  scopes_supported: Schema.Array(Schema.String),
});

/** What a client reads of the authorization server metadata (RFC 8414). */
const ServerMetadata = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  code_challenge_methods_supported: Schema.Array(Schema.String),
  client_id_metadata_document_supported: Schema.optional(Schema.Boolean),
  registration_endpoint: Schema.optional(Schema.String),
});

const SessionToken = Schema.Struct({ token: Schema.String });

test("a client without a token gets 401 with the resource metadata to find the authorization server", async ({
  request,
  baseURL,
}) => {
  const refused = await request.post("/mcp", { data: INITIALIZE, headers: JSON_RPC });

  expect(refused.status()).toBe(401);

  const challenge = refused.headers()["www-authenticate"] ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];

  expect(metadataUrl).toBe(`${baseURL}/.well-known/oauth-protected-resource/mcp`);

  const resource = Schema.decodeUnknownSync(ResourceMetadata)(
    await (await request.get(metadataUrl ?? "")).json(),
  );

  expect(resource.resource).toBe(`${baseURL}/mcp`);
  expect(resource.scopes_supported).toEqual(["read", "write"]);

  const [issuer] = resource.authorization_servers;
  const issuerUrl = new URL(issuer);

  const server = Schema.decodeUnknownSync(ServerMetadata)(
    await (
      await request.get(
        `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname}`,
      )
    ).json(),
  );

  expect(server.issuer).toBe(issuer);
  expect(server.authorization_endpoint).toContain("/oauth2/authorize");
  expect(server.code_challenge_methods_supported).toContain("S256");
  // Clients come by their metadata document; nobody registers one dynamically.
  expect(server.client_id_metadata_document_supported).toBe(true);
  expect(server.registration_endpoint).toBeUndefined();
});

test("a read-only token is refused a write", async ({ userPage, baseURL, mcpClientId }) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  // The user chose read only although the client asked for both: the token carries no write
  // scope, so the door refuses every write action (the refusal itself is proved on a write
  // action in packages/mcp, door.test.ts, until a family of v0.2 brings the first real write).
  const scopes = (session.tokens()?.scope ?? "").split(" ");

  expect(scopes).toContain("read");
  expect(scopes).not.toContain("write");

  const { tools } = await session.client.listTools();

  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  }

  expect((await askMonth(session, "2026-10")).isError).toBe(false);
});

test("a token for another resource is refused", async ({ userPage, baseURL, request }) => {
  // A token Gousset signed with its own keys, for the app itself rather than for `/mcp`.
  const forTheApp = await userPage.request.get("/api/auth/token");

  expect(forTheApp.ok()).toBe(true);

  const { token } = Schema.decodeUnknownSync(SessionToken)(await forTheApp.json());

  const refused = await request.post(`${baseURL}/mcp`, {
    data: INITIALIZE,
    headers: { ...JSON_RPC, authorization: `Bearer ${token}` },
  });

  expect(refused.status()).toBe(401);
  expect(refused.headers()["www-authenticate"]).toContain('error="invalid_token"');
});

test("both protocol revisions list the same tools in the same order", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
    revision: "2025-11-25",
  });

  const modern = await session.connectAgain("2026-07-28");

  expect(session.client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
  expect(modern.getNegotiatedProtocolVersion()).toBe("2026-07-28");

  const legacyTools = (await session.client.listTools()).tools;
  const modernTools = (await modern.listTools()).tools;

  expect(legacyTools.map((tool) => tool.name)).toEqual(["month"]);
  expect(modernTools).toEqual(legacyTools);
  expect(modern.getInstructions()).toBe(session.client.getInstructions());
});

test("an MCP client answers how much was spent last month, and where, from month", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  expect(session.tokens()?.scope?.split(" ")).toContain("write");
  expect(session.client.getInstructions()).toContain("`month`");

  const { text, isError } = await askMonth(session, "2026-10");

  expect(isError).toBe(false);
  expect(text).toContain("October 2026, made-up data");
  expect(text).toMatch(/Spent: [\d,]+\.\d\d EUR/);
  expect(text).toContain("By category:");
  expect(text).toContain("By merchant:");
});

test("revoking a client in the settings shuts it out at once", async ({
  userPage,
  baseURL,
  mcpClientId,
  request,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  expect((await askMonth(session, "2026-10")).isError).toBe(false);

  await userPage.goto("/settings");
  await expect(userPage.getByRole("list", { name: "Connected clients" })).toContainText(
    "Gousset end-to-end tests",
  );
  await userPage.getByRole("button", { name: "Revoke Gousset end-to-end tests" }).click();
  await expect(userPage.getByText("No client is connected.")).toBeVisible();

  // The access token has not expired, yet the very next call is refused.
  const refused = await request.post(`${baseURL}/mcp`, {
    data: INITIALIZE,
    headers: { ...JSON_RPC, authorization: `Bearer ${session.tokens()?.access_token}` },
  });

  expect(refused.status()).toBe(401);

  // And its refresh token gets it no new one.
  const refreshed = await request.post(`${baseURL}/api/auth/oauth2/token`, {
    form: {
      grant_type: "refresh_token",
      refresh_token: session.tokens()?.refresh_token ?? "",
      client_id: mcpClientId,
    },
  });

  expect(refreshed.ok()).toBe(false);
});

test("the administrator's switch closes the door, its metadata included", async ({
  userPage,
  baseURL,
  mcpClientId,
  request,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const withToken = {
    data: INITIALIZE,
    headers: { ...JSON_RPC, authorization: `Bearer ${session.tokens()?.access_token}` },
  };

  await userPage.goto("/settings");
  await userPage.getByRole("button", { name: "Turn off MCP access" }).click();
  await expect(userPage.getByRole("button", { name: "Turn on MCP access" })).toBeVisible();

  try {
    expect((await request.post(`${baseURL}/mcp`, withToken)).status()).toBe(404);
    expect(
      (await request.get(`${baseURL}/.well-known/oauth-protected-resource/mcp`)).status(),
    ).toBe(404);
    expect(
      (await request.get(`${baseURL}/.well-known/oauth-authorization-server/api/auth`)).status(),
    ).toBe(404);
    expect((await request.get(`${baseURL}/api/auth/oauth2/authorize`)).status()).toBe(404);
  } finally {
    await userPage.getByRole("button", { name: "Turn on MCP access" }).click();
    await expect(userPage.getByRole("button", { name: "Turn off MCP access" })).toBeVisible();
  }

  expect((await request.post(`${baseURL}/mcp`, withToken)).status()).toBe(200);
});

test("only the administrator sees the switch", async ({ secondUserPage }) => {
  await secondUserPage.goto("/settings");

  await expect(secondUserPage.getByRole("heading", { name: "Connected clients" })).toBeVisible();
  await expect(secondUserPage.getByRole("button", { name: /MCP access/ })).toHaveCount(0);
});
