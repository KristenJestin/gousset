import {
  clientName,
  isMcpDoorOpen,
  listConnectedClients,
  revokeClient,
  setMcpDoorOpen,
} from "@gousset/auth/mcp-door";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";

import { mcpAddress } from "@/lib/mcp-door";
import { auth, db } from "@/services";

/** The signed-in user; the pages' guards send everyone else to sign in. */
const signedIn = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });

  if (session === null) {
    throw new Error("Sign in first.");
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
          address: client.address,
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
      throw new Error("Only the administrator opens or closes the MCP door.");
    }

    return Effect.runPromise(Effect.promise(() => setMcpDoorOpen(db, data.open)));
  });

/** The client asking for access, by the name it gives itself, for the consent page. */
export const getConsentClient = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ clientId: Schema.String })))
  .handler(({ data }) =>
    Effect.runPromise(
      Effect.promise(async () => ({ name: (await clientName(db, data.clientId)) ?? null })),
    ),
  );
