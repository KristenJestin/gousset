import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";

import { TEST_CLIENT_ID, TEST_REDIRECT_URL } from "./oauth-client";

/**
 * An OAuth client held in memory for one test. The authorization step happens in a signed-in
 * page, as a person would do it from their MCP client.
 */
class BrowserOAuthClient implements OAuthClientProvider {
  readonly redirectUrl = TEST_REDIRECT_URL;
  readonly clientMetadataUrl: string | undefined;
  authorizationUrl: URL | undefined;
  #scope: string;
  #information: StoredOAuthClientInformation | undefined;
  #tokens: StoredOAuthTokens | undefined;
  #codeVerifier: string | undefined;
  #discovery: OAuthDiscoveryState | undefined;

  constructor(scope: string, clientMetadataUrl: string | undefined, clientId: string | undefined) {
    this.#scope = scope;
    this.clientMetadataUrl = clientMetadataUrl;
    this.#information = clientId === undefined ? undefined : { client_id: clientId };
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Gousset end-to-end tests",
      redirect_uris: [TEST_REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: this.#scope,
    };
  }

  clientInformation() {
    return this.#information;
  }

  saveClientInformation(information: StoredOAuthClientInformation) {
    this.#information = information;
  }

  tokens() {
    return this.#tokens;
  }

  saveTokens(tokens: StoredOAuthTokens) {
    this.#tokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string) {
    this.#codeVerifier = codeVerifier;
  }

  codeVerifier() {
    if (this.#codeVerifier === undefined) {
      throw new Error("No authorization was started.");
    }

    return this.#codeVerifier;
  }

  // Kept so that the client checks the code comes back from the authorization server it found.
  saveDiscoveryState(state: OAuthDiscoveryState) {
    this.#discovery = state;
  }

  discoveryState() {
    return this.#discovery;
  }
}

/** The two protocol revisions Gousset serves (docs/mcp.md, "The door"). */
export type Revision = "2025-11-25" | "2026-07-28";

export type McpConnection = {
  /** The app's address; the MCP door is its `/mcp`. */
  baseURL: string;
  /** A page signed in as the user who authorizes the client. */
  page: Page;
  /** What the user does on the consent page, once the browser is on it. */
  consent: (page: Page) => Promise<void>;
  /** `read`, or `read write` (docs/mcp.md, "Authorization and scopes"). */
  scope: string;
  /** The client's metadata document (CIMD), when the server identifies clients by it. */
  clientMetadataUrl?: string;
  /** A client the server already knows; the harness's own by default (`registerTestClient`). */
  clientId?: string;
  /** The protocol revision the client speaks; 2025-11-25 (`initialize`) by default. */
  revision?: Revision;
};

/** A connected client, and the tokens its authorization gave it. */
export type McpSession = {
  client: Client;
  tokens: () => StoredOAuthTokens | undefined;
  /** Another client on the same authorization, speaking another revision. */
  connectAgain: (revision: Revision) => Promise<Client>;
};

function connectedClient(revision: Revision) {
  return new Client(
    { name: "gousset-e2e", version: "0.0.0" },
    revision === "2026-07-28" ? { versionNegotiation: { mode: { pin: revision } } } : {},
  );
}

/**
 * Connects the official MCP client to `/mcp` through the real OAuth flow: the server answers 401,
 * the client finds the authorization server from the protected resource metadata, the signed-in
 * page goes through consent, and the code comes back to the client, which exchanges it for a
 * token bound to `/mcp`.
 */
export async function connectMcp(connection: McpConnection): Promise<McpSession> {
  const endpoint = new URL("/mcp", connection.baseURL);
  const revision = connection.revision ?? "2025-11-25";

  const provider = new BrowserOAuthClient(
    connection.scope,
    connection.clientMetadataUrl,
    connection.clientMetadataUrl === undefined
      ? (connection.clientId ?? TEST_CLIENT_ID)
      : undefined,
  );

  const connectAgain = async (again: Revision) => {
    const client = connectedClient(again);

    await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));

    return client;
  };

  const first = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });

  try {
    const client = connectedClient(revision);

    await client.connect(first);

    return { client, tokens: () => provider.tokens(), connectAgain };
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || provider.authorizationUrl === undefined) {
      throw error;
    }
  }

  const callback = new Promise<URL>((resolve) => {
    void connection.page.route(`${TEST_REDIRECT_URL}**`, async (route) => {
      resolve(new URL(route.request().url()));
      // What a client's own page would say; the harness checks the screen a test ends on.
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><title>Connected</title><main><h1>Connected</h1></main></html>',
      });
    });
  });

  await connection.page.goto(provider.authorizationUrl.toString());
  await connection.consent(connection.page);

  const returned = (await callback).searchParams;

  if (returned.get("code") === null) {
    throw new Error(`The authorization came back without a code: ${returned.toString()}`);
  }

  // The whole answer, so that the client checks its issuer (RFC 9207) as well as its code.
  await first.finishAuth(returned);

  return { client: await connectAgain(revision), tokens: () => provider.tokens(), connectAgain };
}
