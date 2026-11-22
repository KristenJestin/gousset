import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";

/**
 * Where the authorization server sends the browser back. Nothing listens there: the browser's
 * request is caught by the page before it leaves.
 */
const REDIRECT_URL = "http://127.0.0.1:9/mcp/callback";

/**
 * An OAuth client held in memory for one test. The authorization step happens in a signed-in
 * page, as a person would do it from their MCP client.
 */
class BrowserOAuthClient implements OAuthClientProvider {
  readonly redirectUrl = REDIRECT_URL;
  readonly clientMetadataUrl: string | undefined;
  authorizationUrl: URL | undefined;
  #scope: string;
  #information: StoredOAuthClientInformation | undefined;
  #tokens: StoredOAuthTokens | undefined;
  #codeVerifier: string | undefined;

  constructor(scope: string, clientMetadataUrl: string | undefined) {
    this.#scope = scope;
    this.clientMetadataUrl = clientMetadataUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Gousset end-to-end tests",
      redirect_uris: [REDIRECT_URL],
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
}

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
};

function connectedClient() {
  return new Client({ name: "gousset-e2e", version: "0.0.0" });
}

/**
 * Connects the official MCP client to `/mcp` through the real OAuth flow: the server answers 401,
 * the client finds the authorization server, the signed-in page goes through consent, and the
 * code comes back to the client, which exchanges it for a token.
 *
 * Not run yet: the MCP door comes with #39, and its consent page decides what `consent` does.
 */
export async function connectMcp(connection: McpConnection): Promise<Client> {
  const endpoint = new URL("/mcp", connection.baseURL);
  const provider = new BrowserOAuthClient(connection.scope, connection.clientMetadataUrl);
  const first = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });

  try {
    const client = connectedClient();

    await client.connect(first);

    return client;
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || provider.authorizationUrl === undefined) {
      throw error;
    }
  }

  const callback = new Promise<URL>((resolve) => {
    void connection.page.route(`${REDIRECT_URL}**`, async (route) => {
      resolve(new URL(route.request().url()));
      await route.fulfill({ contentType: "text/html", body: "<title>Connected</title>" });
    });
  });

  await connection.page.goto(provider.authorizationUrl.toString());
  await connection.consent(connection.page);
  await first.finishAuth((await callback).searchParams);

  const client = connectedClient();

  await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));

  return client;
}
