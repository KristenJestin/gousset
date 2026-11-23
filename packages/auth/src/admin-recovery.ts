import { randomBytes } from "node:crypto";

import type { Database } from "@gousset/db";
import { authAccount, authUser } from "@gousset/db/schema/auth";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { PasswordResetFailed, replaceWithTemporaryPassword } from "./password-reset";

/**
 * The e-mail given is not the administrator's: nothing was changed. `administrators` names the
 * administrator's e-mail, for whoever runs the installation and forgot which it is.
 */
export class AdministratorRecoveryRefused extends Schema.TaggedError<AdministratorRecoveryRefused>()(
  "AdministratorRecoveryRefused",
  { email: Schema.String, administrators: Schema.Array(Schema.String) },
) {}

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => new PasswordResetFailed() });

/** better-auth's own defaults (8 to 128): 24 characters of base64url, 144 random bits. */
const TEMPORARY_PASSWORD_BYTES = 18;

/**
 * Recovers the administrator's account when they forgot their password, from the server: there is
 * one administrator per installation (admin-access.ts), and no one in the app can reset theirs
 * (`CANNOT_RESET_ADMINISTRATOR`). Whoever runs the installation runs the image's `recover-admin`
 * command (docs/releases.md, "Recovering the administrator"), which calls this as the tables' owner.
 *
 * Refused for any e-mail but the administrator's. Otherwise the same reset as the administrator
 * gives a user (`resetPassword`): a temporary password, to change at the next sign-in, every
 * session ended and every MCP client cut off. The temporary password is drawn here and given back
 * once, for the command to show; it is never kept anywhere but as its hash.
 */
export function recoverAdministrator(
  database: Database,
  email: string,
): Effect.Effect<string, AdministratorRecoveryRefused | PasswordResetFailed> {
  return Effect.gen(function* () {
    // better-auth keeps e-mails in lower case.
    const wanted = email.trim().toLowerCase();

    const administrators = yield* attempt(() =>
      database
        .select({ id: authUser.id, email: authUser.email })
        .from(authUser)
        .innerJoin(
          authAccount,
          and(eq(authAccount.userId, authUser.id), eq(authAccount.providerId, "credential")),
        )
        .where(eq(authUser.role, "admin")),
    );

    const administrator = administrators.find((candidate) => candidate.email === wanted);

    if (administrator === undefined) {
      return yield* new AdministratorRecoveryRefused({
        email: wanted,
        administrators: administrators.map((candidate) => candidate.email),
      });
    }

    const temporaryPassword = randomBytes(TEMPORARY_PASSWORD_BYTES).toString("base64url");
    const hash = yield* attempt(() => hashPassword(temporaryPassword));

    yield* attempt(() => replaceWithTemporaryPassword(database, administrator.id, hash));

    return temporaryPassword;
  });
}
