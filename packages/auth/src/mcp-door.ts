import type { Database } from "@gousset/db";
import {
  authOauthAccessToken,
  authOauthClient,
  authOauthConsent,
  authOauthRefreshToken,
  authUser,
} from "@gousset/db/schema/auth";
import { installationSettings } from "@gousset/db/schema/settings";
import { and, asc, eq, inArray, isNull, like, lt, max, notExists } from "drizzle-orm";

import { McpScope } from "./mcp";
import { clientHost } from "./mcp-guards";

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
  /** The name it gives itself. */
  name: string;
  /** The host its client ID is served from (`clientHost`). */
  host: string | null;
  canWrite: boolean;
  since: Date | null;
};

/** The client asking for access, for the consent page; `undefined` for an unknown client. */
export async function consentClient(
  database: Database,
  clientId: string,
): Promise<{ name: string; host: string | null } | undefined> {
  const [row] = await database
    .select({ name: authOauthClient.name })
    .from(authOauthClient)
    .where(eq(authOauthClient.clientId, clientId));

  return row === undefined ? undefined : { name: row.name ?? clientId, host: clientHost(clientId) };
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
    host: clientHost(row.clientId),
    canWrite: row.scopes.includes(McpScope.write),
    since: row.since,
  }));
}

/** Revokes the user's refresh and access tokens of one client, or of every client. */
async function revokeTokens(database: Pick<Database, "update">, userId: string, clientId?: string) {
  const now = new Date();

  const ofRefresh = and(
    eq(authOauthRefreshToken.userId, userId),
    clientId === undefined ? undefined : eq(authOauthRefreshToken.clientId, clientId),
    isNull(authOauthRefreshToken.revoked),
  );

  const ofAccess = and(
    eq(authOauthAccessToken.userId, userId),
    clientId === undefined ? undefined : eq(authOauthAccessToken.clientId, clientId),
    isNull(authOauthAccessToken.revoked),
  );

  await database.update(authOauthRefreshToken).set({ revoked: now }).where(ofRefresh);
  await database.update(authOauthAccessToken).set({ revoked: now }).where(ofAccess);
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
  await database.transaction(async (transaction) => {
    await transaction
      .delete(authOauthConsent)
      .where(and(eq(authOauthConsent.userId, userId), eq(authOauthConsent.clientId, clientId)));

    await revokeTokens(transaction, userId, clientId);
  });
}

/**
 * Revokes every client of a user: when their password changes or they are banned, nothing they
 * allowed before keeps reaching their data.
 */
export async function revokeAllClients(database: Database, userId: string): Promise<void> {
  await database.transaction((transaction) => revokeAllClientsWithin(transaction, userId));
}

/** `revokeAllClients` inside a transaction the caller holds, with its other changes. */
export async function revokeAllClientsWithin(
  transaction: Pick<Database, "delete" | "update">,
  userId: string,
): Promise<void> {
  await transaction.delete(authOauthConsent).where(eq(authOauthConsent.userId, userId));
  await revokeTokens(transaction, userId);
}

/**
 * After a consent changed in place (a client authorized again, read only this time): the tokens
 * holding a scope the consent no longer gives are revoked, so that a refresh token cannot mint
 * write access the user took back.
 */
export async function alignTokensWithConsents(database: Database, userId: string): Promise<void> {
  const consents = await database
    .select({ clientId: authOauthConsent.clientId, scopes: authOauthConsent.scopes })
    .from(authOauthConsent)
    .where(eq(authOauthConsent.userId, userId));

  const allowed = new Map(consents.map((consent) => [consent.clientId, new Set(consent.scopes)]));

  const exceeds = (clientId: string, scopes: ReadonlyArray<string>) =>
    scopes.some((scope) => allowed.get(clientId)?.has(scope) !== true);

  const refreshTokens = await database
    .select({
      id: authOauthRefreshToken.id,
      clientId: authOauthRefreshToken.clientId,
      scopes: authOauthRefreshToken.scopes,
    })
    .from(authOauthRefreshToken)
    .where(and(eq(authOauthRefreshToken.userId, userId), isNull(authOauthRefreshToken.revoked)));

  const accessTokens = await database
    .select({
      id: authOauthAccessToken.id,
      clientId: authOauthAccessToken.clientId,
      scopes: authOauthAccessToken.scopes,
    })
    .from(authOauthAccessToken)
    .where(and(eq(authOauthAccessToken.userId, userId), isNull(authOauthAccessToken.revoked)));

  const now = new Date();
  const overRefresh = refreshTokens.filter((token) => exceeds(token.clientId, token.scopes));
  const overAccess = accessTokens.filter((token) => exceeds(token.clientId, token.scopes));

  if (overRefresh.length > 0) {
    await database
      .update(authOauthRefreshToken)
      .set({ revoked: now })
      .where(
        inArray(
          authOauthRefreshToken.id,
          overRefresh.map((token) => token.id),
        ),
      );
  }

  if (overAccess.length > 0) {
    await database
      .update(authOauthAccessToken)
      .set({ revoked: now })
      .where(
        inArray(
          authOauthAccessToken.id,
          overAccess.map((token) => token.id),
        ),
      );
  }
}

/** What the user allows a client today, as the door reads it on every call. */
export type Grant = {
  scopes: ReadonlyArray<string>;
  /** When the user allowed it (better-auth keeps it to the second). */
  since: Date;
  /**
   * The last time a token of this client was revoked for the user (a revocation, a consent that
   * narrowed), to the millisecond: a token minted no later than that is refused.
   */
  revokedUntil: Date | undefined;
};

/**
 * The grant a token of this client may use now: none when the user revoked the client, is banned,
 * or holds a temporary password (#70). Read on every call, since a signed access token stays valid
 * until it expires.
 */
export async function currentGrant(
  database: Database,
  userId: string,
  clientId: string,
  now = new Date(),
): Promise<Grant | undefined> {
  const [row] = await database
    .select({
      scopes: authOauthConsent.scopes,
      since: authOauthConsent.createdAt,
      banned: authUser.banned,
      banExpires: authUser.banExpires,
      mustChangePassword: authUser.mustChangePassword,
    })
    .from(authOauthConsent)
    .innerJoin(authUser, eq(authUser.id, authOauthConsent.userId))
    .where(and(eq(authOauthConsent.userId, userId), eq(authOauthConsent.clientId, clientId)))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  const banned = row.banned === true && (row.banExpires === null || row.banExpires > now);

  if (banned || row.mustChangePassword) {
    return undefined;
  }

  const [refresh] = await database
    .select({ last: max(authOauthRefreshToken.revoked) })
    .from(authOauthRefreshToken)
    .where(
      and(eq(authOauthRefreshToken.userId, userId), eq(authOauthRefreshToken.clientId, clientId)),
    );

  const [access] = await database
    .select({ last: max(authOauthAccessToken.revoked) })
    .from(authOauthAccessToken)
    .where(
      and(eq(authOauthAccessToken.userId, userId), eq(authOauthAccessToken.clientId, clientId)),
    );

  const revocations = [refresh?.last, access?.last].filter(
    (last): last is Date => last !== null && last !== undefined,
  );

  return {
    scopes: row.scopes,
    since: row.since ?? new Date(0),
    revokedUntil:
      revocations.length === 0
        ? undefined
        : new Date(Math.max(...revocations.map((last) => last.getTime()))),
  };
}

/**
 * Forgets the clients that came by their metadata document but that no user ever allowed, once
 * older than `before`: anyone can make one exist by starting an authorization.
 */
export async function forgetUnallowedClients(database: Database, before: Date): Promise<void> {
  await database
    .delete(authOauthClient)
    .where(
      and(
        like(authOauthClient.clientId, "https://%"),
        lt(authOauthClient.createdAt, before),
        notExists(
          database
            .select({ id: authOauthConsent.id })
            .from(authOauthConsent)
            .where(eq(authOauthConsent.clientId, authOauthClient.clientId)),
        ),
        notExists(
          database
            .select({ id: authOauthRefreshToken.id })
            .from(authOauthRefreshToken)
            .where(eq(authOauthRefreshToken.clientId, authOauthClient.clientId)),
        ),
      ),
    );
}
