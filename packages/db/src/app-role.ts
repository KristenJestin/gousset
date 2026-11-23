// The role the app logs in with (docs/data-model.md, "Ownership and isolation"; #66). The tables'
// owner runs the migrations; the app logs in as `gousset_app`, which owns no table, is no
// superuser and does not bypass row-level security: a query outside `UserData`, or one that undoes
// its role, reaches nothing of a user's. Its password is derived from the owner's, so that an
// installation keeps giving one URL to `migrate` and to the app, and nothing new is made or kept.
//
// A URL is read by the driver's own parser (pg-connection-string), never by `new URL`: what `pg`
// accepts is accepted here (a socket's host, a stray `%`, `?user=` and `?password=`), and a URL it
// cannot read fails with the URL redacted from the error.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

import { parse, toClientConfig } from "pg-connection-string";

/** The role the app logs in with; a migration makes it, `migrate` lets it log in. */
export const APP_ROLE = "gousset_app";

/**
 * The app role's password: an HMAC of its name keyed with the owner's password, so that whoever
 * learns the app's password learns nothing of the owner's.
 */
export function appRolePassword(ownerPassword: string): string {
  return createHmac("sha256", ownerPassword).update(APP_ROLE).digest("base64url");
}

/** The role a connection string logs in as, query parameters included; empty when it names none. */
export function connectionUser(connectionString: string): string {
  return parse(connectionString).user ?? "";
}

/**
 * How the app connects, from the URL it is given: the owner's becomes the app role's, with the
 * derived password, whatever else the URL says (host, socket, port, database, SSL) kept; one that
 * already names the app role is kept as it is. An owner's URL without a password gives none.
 */
export function appConnection(given: string) {
  const options = parse(given);

  if (options.user === APP_ROLE) {
    return toClientConfig(options);
  }

  const { password = "", ...rest } = options;

  return toClientConfig(
    password === ""
      ? { ...rest, user: APP_ROLE }
      : { ...rest, user: APP_ROLE, password: appRolePassword(password) },
  );
}

const SCRAM_ITERATIONS = 4096;

/**
 * A SCRAM-SHA-256 verifier of `password`, the form Postgres stores (RFC 5802, 7677): given to
 * `ALTER ROLE … PASSWORD`, it keeps the password itself out of the server's logs, where a failed
 * statement is written whole.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest("base64");
  const serverKey = createHmac("sha256", salted).update("Server Key").digest("base64");

  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString("base64")}$${storedKey}:${serverKey}`;
}

/**
 * The statement `migrate` runs, as the owner, once the migrations are applied: the app role logs
 * in, with the password derived from the owner's. An owner's URL without a password (a socket's
 * trust) leaves the app role's password as it is; the owner's password is read from the URL only,
 * never from PGPASSWORD or a password file, as the app reads it.
 */
export function appLoginStatement(ownerUrl: string, salt?: Buffer): string {
  const password = parse(ownerUrl).password ?? "";

  if (password === "") {
    return `ALTER ROLE ${APP_ROLE} WITH LOGIN`;
  }

  // Base64 and `$:` only: nothing to escape in the literal.
  return `ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${scramVerifier(appRolePassword(password), salt)}'`;
}
