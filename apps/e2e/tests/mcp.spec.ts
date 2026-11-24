import type { Browser, Page } from "@playwright/test";
import { request as apiRequest } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/client";
import { Schema } from "effect";

import { startWorkerEnvironment } from "../src/app-server";
import type { WorkerEnvironment } from "../src/app-server";
import { addUser, madeUpUser, signUp } from "../src/auth";
import type { TestUser } from "../src/auth";
import { authorizeByHand, clientWithToken, refreshStatus } from "../src/oauth-by-hand";
import {
  TEST_CLIENT_ID,
  TEST_REDIRECT_URL,
  clientExists,
  registerTestClient,
  writeUnallowedClient,
} from "../src/oauth-client";
import { connectMcp, expect, test } from "../src/test";

// The scenarios of issue #39, "How to verify", one test each, through the official MCP client and
// the real OAuth flow, plus the door's own rules: revocation at once and for good, the consent
// page, the administrator's switch, and what cuts a user's clients off.

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const askMonth = (client: Client) =>
  callText(client, "month", { action: "summary", month: "2026-10" });

/** The test-only write action the harness's app serves (GOUSSET_E2E_PROBE). */
const write = (client: Client) => callText(client, "e2e_probe", { action: "write" });

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

/** The status `/mcp` answers a first request carrying this access token. */
async function doorStatus(baseURL: string, accessToken: string | undefined) {
  const context = await apiRequest.newContext();

  try {
    const answer = await context.post(`${baseURL}/mcp`, {
      data: INITIALIZE,
      headers: { ...JSON_RPC, authorization: `Bearer ${accessToken ?? ""}` },
    });

    return answer.status();
  } finally {
    await context.dispose();
  }
}

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

const SessionUser = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) });

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

  // The user chose read only although the client asked for both.
  expect(session.tokens()?.scope?.split(" ")).not.toContain("write");

  const refused = await write(session.client);

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("allowed to read only");
  expect(refused.text).toContain("Read and write");
  expect((await askMonth(session.client)).isError).toBe(false);
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

  // Gousset's tools, then the harness's test-only write action.
  expect(legacyTools.map((tool) => tool.name)).toEqual([
    "month",
    "imports",
    "accounts",
    "data",
    "lines",
    "merchants",
    "categories",
    "rules",
    "e2e_probe",
  ]);
  expect(modernTools).toEqual(legacyTools);
  expect(modern.getInstructions()).toBe(session.client.getInstructions());
});

test("an MCP client reads with read and write, and its write goes through", async ({
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

  // The review is not available yet (#126): month says so, a read like any other.
  const { text, isError } = await askMonth(session.client);

  expect(isError).toBe(false);
  expect(text).toContain("The monthly review is not available yet");

  // Read and write: the write goes through.
  expect(await write(session.client)).toEqual({
    text: "The write was allowed; nothing was changed.",
    isError: false,
  });
});

test("the consent page says where the client will be sent back", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: async (page) => {
      await expect(
        page.getByText(`It will be sent back to ${new URL(TEST_REDIRECT_URL).host}.`),
      ).toBeVisible();
      await allowReadOnly(page);
    },
    scope: "read write",
    clientId: mcpClientId,
  });
});

// Issue #123: the consent's parts, as the route builds them from what the client asks.
test("the consent page says what write allows only when write is asked", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: async (page) => {
      await expect(page.getByRole("heading", { name: "It also asks to write" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Allow/ })).toHaveCount(2);
      await expect(
        page.getByText("You can revoke it at any time in Settings › General › Connected clients."),
      ).toBeVisible();
      await allowReadOnly(page);
    },
    scope: "read write",
    clientId: mcpClientId,
  });
});

test("the consent page offers one Allow and no write part when only read is asked", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  // By hand: the official client asks for every scope the server lists.
  const tokens = await authorizeByHand({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: async (page) => {
      await expect(page.getByRole("heading", { name: "It will read" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "It also asks to write" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Allow/ })).toHaveCount(1);
      await page.getByRole("button", { name: "Allow", exact: true }).click();
    },
    scope: "read",
  });

  expect((tokens.scope ?? "").split(" ")).not.toContain("write");
});

test("a client whose redirect is not on its own site is refused before any consent", async ({
  request,
  baseURL,
}) => {
  const authorize = new URL("/api/auth/oauth2/authorize", baseURL);

  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: "https://agent.example.com/oauth/client-metadata.json",
    redirect_uri: "https://attacker.example/callback",
    scope: "read",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
  }).toString();

  const refused = await request.get(authorize.toString(), { maxRedirects: 0 });

  expect(refused.status()).toBe(400);
  expect(refused.headers()["location"]).toBeUndefined();
});

test("a silent authorization is refused to a client the user never allowed", async ({
  request,
  baseURL,
}) => {
  const authorize = new URL("/api/auth/oauth2/authorize", baseURL);

  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: TEST_CLIENT_ID,
    redirect_uri: TEST_REDIRECT_URL,
    scope: "read",
    prompt: "none",
    code_challenge: "x".repeat(43),
    code_challenge_method: "S256",
  }).toString();

  const refused = await request.get(authorize.toString(), { maxRedirects: 0 });

  // Refused on Gousset's own page: never a redirect to the client's address.
  expect(refused.status()).toBe(400);
  expect(refused.headers()["location"]).toBeUndefined();
});

test("a client asking to write alone can still be allowed read only", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  const tokens = await authorizeByHand({
    baseURL: baseURL ?? "",
    page: userPage,
    scope: "write",
    consent: allowReadOnly,
  });

  const scopes = (tokens.scope ?? "").split(" ");

  expect(scopes).toContain("read");
  expect(scopes).not.toContain("write");

  const client = await clientWithToken(baseURL ?? "", tokens.access_token);

  expect((await askMonth(client)).isError).toBe(false);
  expect((await write(client)).isError).toBe(true);
});

test("revoking a client in the settings shuts it out at once", async ({
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
  });

  expect((await askMonth(session.client)).isError).toBe(false);

  await userPage.goto("/settings");
  await expect(userPage.getByRole("list", { name: "Connected clients" })).toContainText(
    "Gousset end-to-end tests",
  );
  await userPage.getByRole("button", { name: "Revoke Gousset end-to-end tests" }).click();
  await expect(userPage.getByText("No client is connected.")).toBeVisible();

  // The access token has not expired, yet the very next call is refused.
  expect(await doorStatus(baseURL ?? "", session.tokens()?.access_token)).toBe(401);
  // And its refresh token gets it no new one.
  expect(await refreshStatus(baseURL ?? "", session.tokens()?.refresh_token ?? "")).not.toBe(200);
});

test("a token issued before a revocation is not revived by allowing the client again", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const before = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  await userPage.goto("/settings");
  await userPage.getByRole("button", { name: "Revoke Gousset end-to-end tests" }).click();
  await expect(userPage.getByText("No client is connected.")).toBeVisible();

  // The same client, allowed again, read only this time.
  const again = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  expect((await askMonth(again.client)).isError).toBe(false);
  expect(await doorStatus(baseURL ?? "", before.tokens()?.access_token)).toBe(401);
});

test("allowing a client again read only takes write back from its earlier tokens", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  expect(mcpClientId).toBe(TEST_CLIENT_ID);

  const first = await authorizeByHand({
    baseURL: baseURL ?? "",
    page: userPage,
    scope: "read write offline_access",
    consent: allowReadAndWrite,
  });

  const earlier = await clientWithToken(baseURL ?? "", first.access_token);

  expect((await write(earlier)).isError).toBe(false);

  // The user is asked again, and allows read only this time.
  await authorizeByHand({
    baseURL: baseURL ?? "",
    page: userPage,
    scope: "read write offline_access",
    consent: allowReadOnly,
    prompt: "consent",
  });

  // The earlier tokens held write: they are revoked, the access token with them.
  expect(await doorStatus(baseURL ?? "", first.access_token)).toBe(401);
  expect(await refreshStatus(baseURL ?? "", first.refresh_token ?? "")).not.toBe(200);
});

test("a failure in the settings is said, and the client stays listed", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  await userPage.goto("/settings");
  // The session ends while the page is open.
  await userPage.context().clearCookies();
  await userPage.getByRole("button", { name: "Revoke Gousset end-to-end tests" }).click();

  const error = userPage.getByText("Your session has ended: sign in again.");

  await expect(error).toBeVisible();
  // Faded in: axe measures its contrast at the end of the test.
  await expect(error).toHaveCSS("opacity", "1");
  await expect(userPage.getByRole("list", { name: "Connected clients" })).toContainText(
    "Gousset end-to-end tests",
  );
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

  await userPage.goto("/settings");
  await userPage.getByRole("button", { name: "Turn off MCP access" }).click();
  await expect(userPage.getByRole("button", { name: "Turn on MCP access" })).toBeVisible();

  try {
    expect(await doorStatus(baseURL ?? "", session.tokens()?.access_token)).toBe(404);
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

  expect(await doorStatus(baseURL ?? "", session.tokens()?.access_token)).toBe(200);
});

test("only the administrator sees the switch", async ({ secondUserPage }) => {
  await secondUserPage.goto("/settings");

  await expect(secondUserPage.getByRole("heading", { name: "Connected clients" })).toBeVisible();
  await expect(secondUserPage.getByRole("button", { name: /MCP access/ })).toHaveCount(0);
});

// What cuts a user's clients off, and what keeps unauthenticated authorizations in check, on an
// installation of their own: a password changes, a user is banned, the per-address limit runs out.
test.describe.serial("on an installation of its own", () => {
  let fresh: WorkerEnvironment;
  let admin: TestUser;
  let member: TestUser;

  test.beforeAll(async ({ app }, testInfo) => {
    test.setTimeout(120_000);
    fresh = await startWorkerEnvironment(app.slot + 400, testInfo.outputPath("mcp-install.log"));
    admin = await signUp(fresh.baseURL, madeUpUser("first", app.slot + 400));
    member = await addUser(fresh.baseURL, admin, madeUpUser("second", app.slot + 400));
  });

  test.afterAll(async () => {
    await fresh.stop();
  });

  /** A page of its own, signed in as `person` on the installation. */
  async function pageAs(browser: Browser, person: TestUser) {
    const context = await browser.newContext({ baseURL: fresh.baseURL });

    await context.addCookies([...person.cookies]);

    return context.newPage();
  }

  /** `person`'s client, connected read only through the consent page. */
  async function connectAs(browser: Browser, person: TestUser) {
    await registerTestClient(fresh.database, fresh.baseURL);

    const page = await pageAs(browser, person);

    const session = await connectMcp({
      baseURL: fresh.baseURL,
      page,
      consent: allowReadOnly,
      scope: "read write",
    });

    await page.context().close();

    return session;
  }

  /** A request context speaking to the installation as `person`'s pages do. */
  const asUser = (person: TestUser) =>
    apiRequest.newContext({
      baseURL: fresh.baseURL,
      extraHTTPHeaders: { Origin: fresh.baseURL },
      storageState: { cookies: [...person.cookies], origins: [] },
    });

  test("clients nobody allowed are forgotten after a day", async () => {
    const stale = "https://stale.example.com/oauth/client-metadata.json";
    const recent = "https://recent.example.com/oauth/client-metadata.json";

    await writeUnallowedClient(fresh.database, stale, 48);
    await writeUnallowedClient(fresh.database, recent, 1);

    const context = await apiRequest.newContext();

    try {
      // Any authorization request sweeps them, at most once an hour.
      await context.get(`${fresh.baseURL}/api/auth/oauth2/authorize`, { maxRedirects: 0 });
    } finally {
      await context.dispose();
    }

    expect(await clientExists(fresh.database, stale)).toBe(false);
    expect(await clientExists(fresh.database, recent)).toBe(true);
  });

  test("a password change shuts out the user's MCP clients", async ({ browser }) => {
    const session = await connectAs(browser, admin);

    expect(await doorStatus(fresh.baseURL, session.tokens()?.access_token)).toBe(200);

    const context = await asUser(admin);

    try {
      const changed = await context.post("/api/auth/change-password", {
        data: { currentPassword: admin.password, newPassword: `${admin.password}-new` },
      });

      expect(changed.ok()).toBe(true);
    } finally {
      await context.dispose();
    }

    expect(await doorStatus(fresh.baseURL, session.tokens()?.access_token)).toBe(401);
    expect(await refreshStatus(fresh.baseURL, session.tokens()?.refresh_token ?? "")).not.toBe(200);
  });

  test("a banned user's MCP clients are shut out", async ({ browser }) => {
    const session = await connectAs(browser, member);

    expect(await doorStatus(fresh.baseURL, session.tokens()?.access_token)).toBe(200);

    const asMember = await asUser(member);
    const asAdmin = await asUser(admin);

    try {
      const { user } = Schema.decodeUnknownSync(SessionUser)(
        await (await asMember.get("/api/auth/get-session")).json(),
      );

      expect(
        (await asAdmin.post("/api/auth/admin/ban-user", { data: { userId: user.id } })).ok(),
      ).toBe(true);
    } finally {
      await asMember.dispose();
      await asAdmin.dispose();
    }

    expect(await doorStatus(fresh.baseURL, session.tokens()?.access_token)).toBe(401);
  });

  test("an address that starts too many authorizations is asked to wait", async () => {
    const context = await apiRequest.newContext();

    try {
      const statuses: Array<number> = [];

      for (let attempt = 0; attempt < 31; attempt += 1) {
        const answer = await context.get(`${fresh.baseURL}/api/auth/oauth2/authorize`, {
          maxRedirects: 0,
        });

        statuses.push(answer.status());
      }

      // The installation's earlier tests made a few authorizations from this address too.
      expect(statuses.slice(0, 20)).not.toContain(429);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await context.dispose();
    }
  });
});
