import { createHash, randomBytes } from "node:crypto";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { request } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { untilConsentWorks } from "./mcp";
import { TEST_CLIENT_ID, TEST_REDIRECT_URL } from "./oauth-client";

/** What the token endpoint answers. */
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
});

export type Tokens = typeof TokenResponse.Type;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export type ByHand = {
  baseURL: string;
  /** A page signed in as the user who authorizes the client. */
  page: Page;
  /** The scopes the client asks for, space-separated. */
  scope: string;
  /** What the user does on the consent page. */
  consent: (page: Page) => Promise<void>;
  /** `consent` asks again even when the user already allowed the client. */
  prompt?: string;
};

/**
 * An authorization made step by step, as a client could make it where the official client chooses
 * for itself (the scopes it asks for, `prompt`): PKCE, the consent in the signed-in page, then the
 * code exchanged for tokens bound to `/mcp`.
 */
export async function authorizeByHand(flow: ByHand): Promise<Tokens> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const resource = `${flow.baseURL}/mcp`;
  const authorize = new URL("/api/auth/oauth2/authorize", flow.baseURL);

  const query = new URLSearchParams({
    response_type: "code",
    client_id: TEST_CLIENT_ID,
    redirect_uri: TEST_REDIRECT_URL,
    scope: flow.scope,
    state: base64url(randomBytes(8)),
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });

  if (flow.prompt !== undefined) {
    query.set("prompt", flow.prompt);
  }

  authorize.search = query.toString();

  const callback = new Promise<URL>((resolve) => {
    void flow.page.route(`${TEST_REDIRECT_URL}**`, async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><title>Connected</title><main><h1>Connected</h1></main></html>',
      });
    });
  });

  await flow.page.goto(authorize.toString());
  await untilConsentWorks(flow.page);
  await flow.consent(flow.page);

  const code = (await callback).searchParams.get("code");

  await flow.page.waitForURL(`${TEST_REDIRECT_URL}**`);
  await flow.page.unroute(`${TEST_REDIRECT_URL}**`);

  if (code === null) {
    throw new Error("The authorization came back without a code.");
  }

  const context = await request.newContext();

  try {
    const answer = await context.post(`${flow.baseURL}/api/auth/oauth2/token`, {
      form: {
        grant_type: "authorization_code",
        code,
        redirect_uri: TEST_REDIRECT_URL,
        client_id: TEST_CLIENT_ID,
        code_verifier: verifier,
        resource,
      },
    });

    if (!answer.ok()) {
      throw new Error(`The token endpoint answered ${answer.status()}.`);
    }

    return Schema.decodeUnknownSync(TokenResponse)(await answer.json());
  } finally {
    await context.dispose();
  }
}

/** The official client, calling `/mcp` with a token it was given, as a client that kept one. */
export async function clientWithToken(baseURL: string, accessToken: string): Promise<Client> {
  const client = new Client({ name: "gousset-e2e", version: "0.0.0" });

  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", baseURL), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );

  return client;
}

/** Asks the token endpoint for a new access token with a refresh token; its HTTP status. */
export async function refreshStatus(baseURL: string, refreshToken: string): Promise<number> {
  const context = await request.newContext();

  try {
    const answer = await context.post(`${baseURL}/api/auth/oauth2/token`, {
      form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: TEST_CLIENT_ID },
    });

    return answer.status();
  } finally {
    await context.dispose();
  }
}
