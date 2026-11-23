import { AuthErrorCode, isHeldForPasswordChange } from "@gousset/auth";
import type { Session } from "@gousset/auth";

import { auth } from "@/services";

/** Why a request reaches nothing of a user's, as a code the interface translates. */
export type SessionRefusal = "SIGN_IN_REQUIRED" | typeof AuthErrorCode.passwordChangeRequired;

/**
 * The session of a request that may reach a user's data or settings, or why it may not: no one is
 * signed in, or the session is held until its user replaces a temporary password, which someone
 * else chose (the administrator, #70, or the server's recovery, #79). Every server function and
 * route of the app reads the session through this, a lint rule sees to it
 * (`gousset/no-direct-session-read`); better-auth's own routes are held by its hook, and the MCP
 * door by `currentGrant` (packages/auth).
 */
export async function usableSession(
  headers: Headers,
): Promise<{ session: Session; refusal?: never } | { session?: never; refusal: SessionRefusal }> {
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    return { refusal: "SIGN_IN_REQUIRED" };
  }

  if (isHeldForPasswordChange(session)) {
    return { refusal: AuthErrorCode.passwordChangeRequired };
  }

  return { session };
}
