import type { Database } from "@gousset/db";
import { authAccount, authSession, authUser } from "@gousset/db/schema/auth";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { Auth } from "./index";
import { revokeAllClientsWithin } from "./mcp-door";

/** Why a reset is refused, as a code the interface translates. */
export const PasswordResetCode = Schema.Literals([
  // No such user, or one without a password of their own to replace.
  "USER_NOT_FOUND",
  // The administrator changes their own password themselves, knowing the current one. There is
  // one administrator per installation (no second one can be named, admin-access.ts), so this is
  // always their own account; when they forget it, whoever runs the installation recovers it from
  // the server (admin-recovery.ts).
  "CANNOT_RESET_ADMINISTRATOR",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
]);

export class PasswordResetRefused extends Schema.TaggedError<PasswordResetRefused>()(
  "PasswordResetRefused",
  { code: PasswordResetCode },
) {}

/**
 * The user chose their own password: the temporary one is no longer held, and the reset's date
 * and source go. Only as the change found it (`resetAt`, read with the session before the change): a reset
 * the administrator committed meanwhile keeps its flag, or the user could end up on a password
 * the administrator chose, with nothing asking them to change it.
 */
export async function clearTemporaryPassword(
  database: Database,
  userId: string,
  resetAt: Date | null,
): Promise<void> {
  await database
    .update(authUser)
    .set({ mustChangePassword: false, passwordResetAt: null, passwordResetBy: null })
    .where(
      and(
        eq(authUser.id, userId),
        resetAt === null ? isNull(authUser.passwordResetAt) : eq(authUser.passwordResetAt, resetAt),
      ),
    );
}

/** The database or the password hashing failed: nothing was changed, the transaction is whole. */
export class PasswordResetFailed extends Schema.TaggedError<PasswordResetFailed>()(
  "PasswordResetFailed",
  {},
) {}

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new PasswordResetFailed() });

/**
 * Who gives a temporary password: the administrator, from the users page, or whoever runs the
 * installation, recovering the administrator's from the server (admin-recovery.ts).
 */
export type PasswordResetBy = NonNullable<(typeof authUser.$inferSelect)["passwordResetBy"]>;

/**
 * The reset itself, in one transaction: the password becomes the temporary one (`hash`), the user
 * must change it at the next sign-in, the reset's time and source (`by`) are kept to show them,
 * every session of the user ends and every MCP client they allowed loses its access.
 */
export async function replaceWithTemporaryPassword(
  database: Database,
  userId: string,
  hash: string,
  by: PasswordResetBy,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .update(authAccount)
      .set({ password: hash })
      .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")));

    await transaction
      .update(authUser)
      .set({ mustChangePassword: true, passwordResetAt: new Date(), passwordResetBy: by })
      .where(eq(authUser.id, userId));

    await transaction.delete(authSession).where(eq(authSession.userId, userId));
    await revokeAllClientsWithin(transaction, userId);
  });
}

/**
 * The administrator gives a user a new temporary password, for a user who forgot theirs. In one
 * transaction: the password is replaced, the user must change it at the next sign-in (so the
 * administrator never knows a password the user keeps), the reset's time is kept to show them,
 * every session of the user ends and every MCP client they allowed loses its access, as after a
 * password change. Until the user changes it, the temporary password opens nothing else
 * (`isHeldForPasswordChange`).
 *
 * The admin plugin's `set-user-password` stays closed (admin-access.ts): it sets a password the
 * user would keep, and ends nothing.
 */
export function resetPassword(
  auth: Auth,
  database: Database,
  userId: string,
  temporaryPassword: string,
): Effect.Effect<void, PasswordResetRefused | PasswordResetFailed> {
  return Effect.gen(function* () {
    const context = yield* attempt(() => auth.$context);
    const { minPasswordLength, maxPasswordLength } = context.password.config;

    if (temporaryPassword.length < minPasswordLength) {
      return yield* new PasswordResetRefused({ code: "PASSWORD_TOO_SHORT" });
    }

    if (temporaryPassword.length > maxPasswordLength) {
      return yield* new PasswordResetRefused({ code: "PASSWORD_TOO_LONG" });
    }

    const [target] = yield* attempt(() =>
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

    const hash = yield* attempt(() => context.password.hash(temporaryPassword));

    yield* attempt(() => replaceWithTemporaryPassword(database, userId, hash, "administrator"));
  });
}
