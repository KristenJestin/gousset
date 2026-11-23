import {
  consentClient,
  isMcpDoorOpen,
  listConnectedClients,
  revokeClient,
  setMcpDoorOpen,
} from "@gousset/auth/mcp-door";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { mcpAddress } from "@/lib/mcp-door";
import { usableSession } from "@/lib/session.server";
import { db } from "@/services";

/** The codes these functions refuse with; the interface translates them (`errorMessage`). */
export const McpRefusal = {
  signInRequired: "SIGN_IN_REQUIRED",
  adminOnly: "ADMIN_ONLY",
} as const;

/** The signed-in user; the pages' guards send everyone else to sign in. */
export const signedIn = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { session, refusal } = await usableSession(getRequestHeaders());

  // A temporary password reaches no setting of the user's: someone else chose it (#70, #79).
  if (session === undefined) {
    throw new Error(refusal === "SIGN_IN_REQUIRED" ? McpRefusal.signInRequired : refusal);
  }

  return next({ context: { userId: session.user.id, isAdmin: session.user.role === "admin" } });
});

/** The MCP clients the user allowed, for their settings. */
export const getConnectedClients = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) =>
    Effect.runPromise(
      Effect.promise(async () =>
        (await listConnectedClients(db, context.userId)).map((client) => ({
          clientId: client.clientId,
          name: client.name,
          host: client.host,
          canWrite: client.canWrite,
        })),
      ),
    ),
  );

/** Revokes one of the user's clients: its next call to `/mcp` is refused. */
export const revokeConnectedClient = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ clientId: Schema.String })))
  .handler(({ context, data }) =>
    Effect.runPromise(Effect.promise(() => revokeClient(db, context.userId, data.clientId))),
  );

/**
 * The MCP door, as the administrator's settings show it: whether it is open, and whether the
 * app's address can carry it at all (HTTPS, or a loopback address).
 */
export const getMcpDoor = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) =>
    Effect.runPromise(
      Effect.promise(async () => ({
        canManage: context.isAdmin,
        servable: mcpAddress.resource !== undefined,
        open: await isMcpDoorOpen(db),
        endpoint: `${mcpAddress.origin}/mcp`,
      })),
    ),
  );

/** The administrator opens or closes the MCP door for every user at once. */
export const setMcpDoor = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ open: Schema.Boolean })))
  .handler(({ context, data }) => {
    if (!context.isAdmin) {
      throw new Error(McpRefusal.adminOnly);
    }

    return Effect.runPromise(Effect.promise(() => setMcpDoorOpen(db, data.open)));
  });

/**
 * The client asking for access, for the consent page: the name it gives itself, and the host its
 * client ID is served from, which it cannot choose.
 */
export const getConsentClient = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ clientId: Schema.String })))
  .handler(({ data }) =>
    Effect.runPromise(Effect.promise(async () => (await consentClient(db, data.clientId)) ?? null)),
  );
