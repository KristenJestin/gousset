// The image's `recover-admin` command (docs/releases.md, "Recovering the administrator"): gives the
// administrator who forgot their password a temporary one, which they change at the next sign-in,
// and ends their sessions and MCP clients. Run on the server by whoever runs the installation,
// through the image's entry point, which reads the database password from its secret:
//
//   docker compose exec web gousset recover-admin <the administrator's e-mail>
//
// It logs in as the tables' owner, with DATABASE_URL as `migrate` does: it runs outside the app.
// It prints the temporary password once, on its standard output, and nothing else secret: never
// the URL, never a database error, which may quote it. Bundled into one file by `pnpm build`.
import { relations } from "@gousset/db/relations";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect } from "effect";

import { recoverAdministrator } from "./admin-recovery";

const USAGE = "usage: recover-admin <the administrator's e-mail>\n";

const url = process.env.DATABASE_URL;
const [email, ...rest] = process.argv.slice(2);

if (!url) {
  process.stderr.write(
    "recover-admin: DATABASE_URL is not set (or DATABASE_URL_FILE names no file).\n",
  );
  process.exit(1);
}

if (email === undefined || email.trim() === "" || rest.length > 0) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const database = drizzle({ connection: url, relations });

/** What the command says, and on which stream: the password on the standard output alone. */
type Outcome = { succeeded: boolean; text: string };

const outcome = await Effect.runPromise(
  recoverAdministrator(database, email).pipe(
    Effect.map((temporaryPassword): Outcome => ({
      succeeded: true,
      text: [
        `recover-admin: ${email.trim().toLowerCase()} now signs in with this temporary password,`,
        "and must choose a new one at once:",
        "",
        `  ${temporaryPassword}`,
        "",
        "It is shown once and kept nowhere. Their sessions have ended, and their MCP clients must",
        "be allowed again.",
        "",
      ].join("\n"),
    })),
    Effect.catchTags({
      AdministratorRecoveryRefused: ({ email: refused, administrators }) =>
        Effect.succeed<Outcome>({
          succeeded: false,
          text: `recover-admin: ${refused} is not the administrator's e-mail; nothing was changed. ${
            administrators.length === 0
              ? "The installation has no administrator yet: the first sign-up makes one."
              : `The administrator signs in as ${administrators.join(", ")}.`
          }\n`,
        }),
      PasswordResetFailed: () =>
        Effect.succeed<Outcome>({
          succeeded: false,
          text: "recover-admin: the database could not be read or written; nothing was changed. Check that the database is up and that DATABASE_URL names its owner.\n",
        }),
    }),
  ),
);

try {
  (outcome.succeeded ? process.stdout : process.stderr).write(outcome.text);
  process.exitCode = outcome.succeeded ? 0 : 1;
} finally {
  await database.$client.end();
}
