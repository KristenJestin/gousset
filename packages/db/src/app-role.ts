// The role the app logs in with (docs/data-model.md, "Ownership and isolation"; #66). The tables'
// owner runs the migrations; the app logs in as `gousset_app`, which owns no table, is no
// superuser and does not bypass row-level security: a query outside `UserData`, or one that undoes
// its role, reaches nothing of a user's. Its password is derived from the owner's, so that an
// installation keeps giving one URL to `migrate` and to the app, and nothing new is made or kept.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

/** The role the app logs in with; a migration makes it, `migrate` lets it log in. */
export const APP_ROLE = "gousset_app";

/**
 * The app role's password: an HMAC of its name keyed with the owner's password, so that whoever
 * learns the app's password learns nothing of the owner's.
 */
export function appRolePassword(ownerPassword: string): string {
  return createHmac("sha256", ownerPassword).update(APP_ROLE).digest("base64url");
}

/**
 * The URL the app logs in with, from the one it is given: the owner's becomes the app role's, with
 * the derived password; one that already names the app role is kept as it is.
 */
export function appDatabaseUrl(given: string): string {
  const url = new URL(given);

  if (decodeURIComponent(url.username) === APP_ROLE) {
    return given;
  }

  if (url.host === "") {
    throw new Error(
      "DATABASE_URL names no host: give it as postgresql://<owner>:<password>@<host>:5432/<database>.",
    );
  }

  // The driver decodes the password with decodeURIComponent, as the image's entry point encodes it.
  const password = decodeURIComponent(url.password);

  url.username = APP_ROLE;
  // base64url needs no encoding in a URL.
  url.password = password === "" ? "" : appRolePassword(password);

  return url.href;
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
 * trust) leaves the app role's password as it is.
 */
export function appLoginStatement(ownerUrl: string, salt?: Buffer): string {
  const password = decodeURIComponent(new URL(ownerUrl).password);

  if (password === "") {
    return `ALTER ROLE ${APP_ROLE} WITH LOGIN`;
  }

  // Base64 and `$:` only: nothing to escape in the literal.
  return `ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${scramVerifier(appRolePassword(password), salt)}'`;
}
