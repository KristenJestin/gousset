import type { Database } from "@gousset/db";
import {
  authOauthAccessToken,
  authOauthClient,
  authOauthConsent,
  authOauthRefreshToken,
} from "@gousset/db/schema/auth";
import { installationSettings } from "@gousset/db/schema/settings";
import { and, asc, eq, isNull } from "drizzle-orm";

/** Verifies an MCP access token: signed by Gousset, unexpired, bound to the `/mcp` resource. */
export { requireMcpAuth } from "@better-auth/mcp";

const SETTINGS_ROW = 1;

/** Whether the administrator left the MCP door open (it is, until they close it). */
export async function isMcpDoorOpen(database: Database): Promise<boolean> {
  const [row] = await database
    .select({ open: installationSettings.mcpEnabled })
    .from(installationSettings)
    .where(eq(installationSettings.id, SETTINGS_ROW));

  return row?.open ?? true;
}

/** Opens or closes the MCP door for every user of the installation at once. */
export async function setMcpDoorOpen(database: Database, open: boolean): Promise<void> {
  await database
    .insert(installationSettings)
    .values({ id: SETTINGS_ROW, mcpEnabled: open })
    .onConflictDoUpdate({ target: installationSettings.id, set: { mcpEnabled: open } });
}

/** A client the user allowed to reach their data, as their settings show it. */
export type ConnectedClient = {
  clientId: string;
  name: string;
  /** Where the client says it comes from, if it says so. */
  address: string | null;
  canWrite: boolean;
  since: Date | null;
};

/** The name a client gives itself, for the consent page; `undefined` for an unknown client. */
export async function clientName(
  database: Database,
  clientId: string,
): Promise<string | undefined> {
  const [row] = await database
    .select({ name: authOauthClient.name })
    .from(authOauthClient)
    .where(eq(authOauthClient.clientId, clientId));

  return row === undefined ? undefined : (row.name ?? clientId);
}

/** The clients a user allowed on the consent page, oldest first. */
export async function listConnectedClients(
  database: Database,
  userId: string,
): Promise<Array<ConnectedClient>> {
  const rows = await database
    .select({
      clientId: authOauthConsent.clientId,
      name: authOauthClient.name,
      uri: authOauthClient.uri,
      scopes: authOauthConsent.scopes,
      since: authOauthConsent.createdAt,
    })
    .from(authOauthConsent)
    .innerJoin(authOauthClient, eq(authOauthClient.clientId, authOauthConsent.clientId))
    .where(eq(authOauthConsent.userId, userId))
    .orderBy(asc(authOauthConsent.createdAt));

  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    address: row.uri,
    canWrite: row.scopes.includes("write"),
    since: row.since,
  }));
}

/**
 * Revokes a client for a user, at once: the consent goes, so the door refuses the client's next
 * call even with an access token still unexpired, and its refresh tokens stop working.
 */
export async function revokeClient(
  database: Database,
  userId: string,
  clientId: string,
): Promise<void> {
  const now = new Date();

  await database.transaction(async (transaction) => {
    await transaction
      .delete(authOauthConsent)
      .where(and(eq(authOauthConsent.userId, userId), eq(authOauthConsent.clientId, clientId)));

    await transaction
      .update(authOauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(
          eq(authOauthRefreshToken.userId, userId),
          eq(authOauthRefreshToken.clientId, clientId),
          isNull(authOauthRefreshToken.revoked),
        ),
      );

    await transaction
      .update(authOauthAccessToken)
      .set({ revoked: now })
      .where(
        and(
          eq(authOauthAccessToken.userId, userId),
          eq(authOauthAccessToken.clientId, clientId),
          isNull(authOauthAccessToken.revoked),
        ),
      );
  });
}

/**
 * Whether the user still allows the client: checked on every call, since a signed access token
 * stays valid until it expires and revocation must take effect at once.
 */
export async function isClientAllowed(
  database: Database,
  userId: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: authOauthConsent.id })
    .from(authOauthConsent)
    .where(and(eq(authOauthConsent.userId, userId), eq(authOauthConsent.clientId, clientId)))
    .limit(1);

  return row !== undefined;
}
