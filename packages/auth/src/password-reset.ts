import type { Database } from "@gousset/db";
import { authAccount, authSession, authUser } from "@gousset/db/schema/auth";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { Auth } from "./index";
import { revokeAllClientsWithin } from "./mcp-door";

/** Why a reset is refused, as a code the interface translates. */
export const PasswordResetCode = Schema.Literals([
  // No such user, or one without a password of their own to replace.
  "USER_NOT_FOUND",
  // The administrator changes their own password themselves, knowing the current one.
  "CANNOT_RESET_ADMINISTRATOR",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
]);

export class PasswordResetRefused extends Schema.TaggedError<PasswordResetRefused>()(
  "PasswordResetRefused",
  { code: PasswordResetCode },
) {}

/**
 * The administrator gives a user a new temporary password, for a user who forgot theirs. In one
 * transaction: the password is replaced, the user must change it at the next sign-in (so the
 * administrator never knows a password the user keeps), every session of the user ends and every
 * MCP client they allowed loses its access, as after a password change.
 *
 * The admin plugin's `set-user-password` stays closed (admin-access.ts): it sets a password the
 * user would keep, and ends nothing.
 */
export function resetPassword(
  auth: Auth,
  database: Database,
  userId: string,
  temporaryPassword: string,
): Effect.Effect<void, PasswordResetRefused> {
  return Effect.gen(function* () {
    const context = yield* Effect.promise(() => auth.$context);
    const { minPasswordLength, maxPasswordLength } = context.password.config;

    if (temporaryPassword.length < minPasswordLength) {
      return yield* new PasswordResetRefused({ code: "PASSWORD_TOO_SHORT" });
    }

    if (temporaryPassword.length > maxPasswordLength) {
      return yield* new PasswordResetRefused({ code: "PASSWORD_TOO_LONG" });
    }

    const [target] = yield* Effect.promise(() =>
      database
        .select({ role: authUser.role })
        .from(authUser)
        .innerJoin(
          authAccount,
          and(eq(authAccount.userId, authUser.id), eq(authAccount.providerId, "credential")),
        )
        .where(eq(authUser.id, userId)),
    );

    if (target === undefined) {
      return yield* new PasswordResetRefused({ code: "USER_NOT_FOUND" });
    }

    if (target.role === "admin") {
      return yield* new PasswordResetRefused({ code: "CANNOT_RESET_ADMINISTRATOR" });
    }

    const hash = yield* Effect.promise(() => context.password.hash(temporaryPassword));

    yield* Effect.promise(() =>
      database.transaction(async (transaction) => {
        await transaction
          .update(authAccount)
          .set({ password: hash })
          .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")));

        await transaction
          .update(authUser)
          .set({ mustChangePassword: true })
          .where(eq(authUser.id, userId));

        await transaction.delete(authSession).where(eq(authSession.userId, userId));
        await revokeAllClientsWithin(transaction, userId);
      }),
    );
  });
}
