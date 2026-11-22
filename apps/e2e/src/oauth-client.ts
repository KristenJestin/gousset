import { randomUUID } from "node:crypto";

import pg from "pg";

import { databaseUrl } from "./database";

/** The harness's own MCP client, as the authorization server knows it. */
export const TEST_CLIENT_ID = "gousset-e2e";

/**
 * Where the authorization server sends the browser back. Nothing listens there: the browser's
 * request is caught by the page before it leaves. A port browsers allow (Firefox refuses port 9
 * before the page can catch the request).
 */
export const TEST_REDIRECT_URL = "http://127.0.0.1:47213/mcp/callback";

/**
 * Writes a client as a metadata document would have made it exist, `ageHours` ago, never allowed
 * by anyone: what the app forgets after a day.
 */
export async function writeUnallowedClient(
  database: string,
  clientId: string,
  ageHours: number,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  const createdAt = new Date(Date.now() - ageHours * 3_600_000);

  await client.connect();

  try {
    await client.query(
      `INSERT INTO auth_oauth_client (id, client_id, name, redirect_uris, created_at, updated_at)
       VALUES ($1, $2, 'Stale Example', $3, $4, $4)`,
      [randomUUID(), clientId, ["https://stale.example.com/callback"], createdAt],
    );
  } finally {
    await client.end();
  }
}

/** Whether a client of that ID exists in a worker's database. */
export async function clientExists(database: string, clientId: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    const found = await client.query("SELECT 1 FROM auth_oauth_client WHERE client_id = $1", [
      clientId,
    ]);

    return found.rowCount === 1;
  } finally {
    await client.end();
  }
}

/**
 * Registers the harness's MCP client in a worker's database, linked to the worker's `/mcp`.
 *
 * Gousset identifies MCP clients by their Client ID Metadata Document, which must be served over
 * HTTPS on a public address: a test run has none, so its client is written here, as an
 * administrator would pre-register one, a public client using PKCE like any MCP client. The
 * authorization, the consent, the tokens and their checks are the app's own.
 */
export async function registerTestClient(database: string, baseURL: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  const resource = `${baseURL}/mcp`;
  const now = new Date();

  await client.connect();

  try {
    await client.query(
      `INSERT INTO auth_oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method,
         grant_types, response_types, scopes, require_pkce, application_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'none', $5, $6, $7, true, 'native', $8, $8)
       ON CONFLICT (client_id) DO NOTHING`,
      [
        randomUUID(),
        TEST_CLIENT_ID,
        "Gousset end-to-end tests",
        [TEST_REDIRECT_URL],
        ["authorization_code", "refresh_token"],
        ["code"],
        ["read", "write", "offline_access"],
        now,
      ],
    );

    // The app writes its `/mcp` resource when it starts; the harness waits for it to answer.
    const linked = await client.query(
      `INSERT INTO auth_oauth_client_resource (id, client_id, resource_id, created_at)
       SELECT $1, $2, identifier, $4 FROM auth_oauth_resource WHERE identifier = $3
       ON CONFLICT DO NOTHING`,
      [randomUUID(), TEST_CLIENT_ID, resource, now],
    );

    // Each test authorizes from scratch: what an earlier test of the worker allowed is forgotten.
    await client.query("DELETE FROM auth_oauth_consent WHERE client_id = $1", [TEST_CLIENT_ID]);
    await client.query("DELETE FROM auth_oauth_refresh_token WHERE client_id = $1", [
      TEST_CLIENT_ID,
    ]);

    if (linked.rowCount === 0) {
      const existing = await client.query(
        "SELECT 1 FROM auth_oauth_client_resource WHERE client_id = $1 AND resource_id = $2",
        [TEST_CLIENT_ID, resource],
      );

      if (existing.rowCount !== 1) {
        throw new Error(`The app has not written its MCP resource ${resource} yet.`);
      }
    }
  } finally {
    await client.end();
  }
}
