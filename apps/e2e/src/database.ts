import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { appLoginStatement } from "@gousset/db/app-role";
import pg from "pg";

import { harness } from "./config";

/**
 * Every database of a run carries the run's id, so that two runs on one Postgres (two worktrees
 * on `pnpm db:start`) never drop each other's. Global setup draws it; workers inherit it.
 */
const RUN_ID = "E2E_RUN_ID";

export function newRunId(): string {
  return randomBytes(4).toString("hex");
}

/** Called once, by global setup, before any database is named. */
export function startRun(): void {
  process.env[RUN_ID] = newRunId();
}

function currentRunId(): string {
  const run = process.env[RUN_ID];

  if (run === undefined || !/^[0-9a-f]{8}$/.test(run)) {
    throw new Error(`${RUN_ID} is missing: the harness's global setup sets it before any test.`);
  }

  return run;
}

/** Migrated and seeded once per run; every worker's database is cloned from it. */
export function templateDatabase(run = currentRunId()): string {
  return `gousset_e2e_${run}_template`;
}

/** The drizzle-kit configuration that applies Gousset's migrations, reading its URL from the environment. */
const DRIZZLE_CONFIG = fileURLToPath(new URL("../drizzle.config.ts", import.meta.url));

/**
 * drizzle-kit runs in a process of its own: its SDK keeps a connection to the template open, and
 * Postgres refuses to copy a template in use.
 */
const DRIZZLE_KIT = fileURLToPath(new URL("../node_modules/.bin/drizzle-kit", import.meta.url));

/** One database per worker slot: a worker that restarts after a failure gets a fresh clone. */
export function workerDatabaseName(parallelIndex: number, run = currentRunId()): string {
  return `gousset_e2e_${run}_worker_${parallelIndex}`;
}

/** The harness's server URL, pointed at one of its databases. */
export function databaseUrl(database: string): string {
  const url = new URL(harness.databaseUrl);

  url.pathname = `/${database}`;

  return url.toString();
}

/**
 * Postgres refuses to copy a template while anyone else uses it, another copy included: workers
 * starting at once take turns through this advisory lock (any number, as long as it is the same).
 */
const TEMPLATE_LOCK = 4040;

/**
 * Runs statements one after the other on the server, through the database the harness was given,
 * holding the template lock throughout when asked to.
 */
async function administer(statements: ReadonlyArray<string>, holdingTemplate = false) {
  const client = new pg.Client({ connectionString: harness.databaseUrl });

  await client.connect();

  try {
    if (holdingTemplate) {
      await client.query("SELECT pg_advisory_lock($1)", [TEMPLATE_LOCK]);
    }

    for (const statement of statements) {
      await client.query(statement);
    }
  } finally {
    // Closing the session releases its advisory lock.
    await client.end();
  }
}

/** Names come from this file only; quoting keeps them whole. */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Drops the database if it exists, closing what is connected to it (a server left behind by an
 * interrupted run), then creates it, from `template` when one is given.
 */
export async function recreateDatabase(database: string, template?: string): Promise<void> {
  const from = template === undefined ? "" : ` TEMPLATE ${quoteIdentifier(template)}`;

  await administer(
    [
      `DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`,
      `CREATE DATABASE ${quoteIdentifier(database)}${from}`,
    ],
    template !== undefined,
  );
}

export async function dropDatabase(database: string): Promise<void> {
  await administer([`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`]);
}

/**
 * Applies the migrations of `packages/db` to a database with drizzle-kit. They hold more than the
 * Drizzle schema (the first user's unique index is a migration of its own), so pushing the schema
 * would not build the same database. The URL goes through the environment, never the command
 * line, where any local user could read its password.
 */
async function migrate(database: string): Promise<void> {
  try {
    await promisify(execFile)(DRIZZLE_KIT, ["migrate", `--config=${DRIZZLE_CONFIG}`], {
      // The configuration's paths are relative to apps/e2e.
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, E2E_SCHEMA_URL: databaseUrl(database) },
    });
  } catch {
    throw new Error(
      `drizzle-kit could not migrate ${database}: run \`pnpm db:migrate\` against it to see why.`,
    );
  }
}

/**
 * Builds the template: the migrations of `packages/db`, as an installation applies them, then lets
 * the app's role log in, as the image's `migrate` does (packages/db/src/migrate.ts): each worker's
 * app is given the harness's URL and logs in as that role. The role belongs to the whole server,
 * so its password is set holding the template lock, one run at a time.
 */
export async function prepareTemplate(): Promise<void> {
  const template = templateDatabase();

  await recreateDatabase(template);
  await migrate(template);
  await administer([appLoginStatement(harness.databaseUrl)], true);

  // No made-up data here: a user's rows need their user, and the template has no user yet (each
  // worker signs its own up). A spec that needs rows seeds its users from `packages/fixture`
  // (`openUserData(...).seed`, src/user-data.ts).
}

export async function databaseExists(database: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: harness.databaseUrl });

  await client.connect();

  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);

    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

/** Whether a user with this e-mail exists in a database, read straight from its tables. */
export async function hasUser(database: string, email: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    const result = await client.query('SELECT 1 FROM "auth_user" WHERE email = $1', [email]);

    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

/**
 * The sessions of the user with this e-mail, read straight from its tables: how many there are, and
 * how many someone else opened as them (better-auth's impersonation).
 */
export async function sessionsOf(
  database: string,
  email: string,
): Promise<{ all: number; impersonated: number }> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    const result = await client.query<{ all: number; impersonated: number }>(
      'SELECT count(*)::int AS "all", count(s.impersonated_by)::int AS impersonated FROM "auth_session" s JOIN "auth_user" u ON u.id = s.user_id WHERE u.email = $1',
      [email],
    );

    return result.rows[0] ?? { all: 0, impersonated: 0 };
  } finally {
    await client.end();
  }
}

/**
 * Sets or clears the temporary-password flag of the user with this e-mail, straight in its table:
 * for a state no route reaches, a flagged user whose MCP tokens are still live.
 */
export async function setMustChangePassword(
  database: string,
  email: string,
  flagged: boolean,
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    await client.query('UPDATE "auth_user" SET must_change_password = $1 WHERE email = $2', [
      flagged,
      email,
    ]);
  } finally {
    await client.end();
  }
}

/**
 * Makes the administrator's reset land in the middle of the next password change of the user with
 * this e-mail: as soon as the change writes the new password, a trigger sets the flag and the
 * reset's time, as a reset committed then would. A race no request can time; gives what removes it.
 */
export async function resetDuringNextChange(
  database: string,
  email: string,
): Promise<() => Promise<void>> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });
  const target = `'${email.replaceAll("'", "''")}'`;

  await client.connect();

  try {
    await client.query(`
      CREATE FUNCTION e2e_reset_during_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE "auth_user" SET must_change_password = true, password_reset_at = now()
          WHERE id = NEW.user_id AND email = ${target};
        RETURN NEW;
      END
      $$`);
    await client.query(
      'CREATE TRIGGER e2e_reset_during_change AFTER UPDATE OF password ON "auth_account" FOR EACH ROW EXECUTE FUNCTION e2e_reset_during_change()',
    );
  } finally {
    await client.end();
  }

  return async () => {
    const cleanup = new pg.Client({ connectionString: databaseUrl(database) });

    await cleanup.connect();

    try {
      await cleanup.query('DROP TRIGGER IF EXISTS e2e_reset_during_change ON "auth_account"');
      await cleanup.query("DROP FUNCTION IF EXISTS e2e_reset_during_change()");
    } finally {
      await cleanup.end();
    }
  };
}

/** The colour scheme kept on the account of the user with this e-mail, read straight from its table. */
export async function colorSchemeOf(database: string, email: string): Promise<string | undefined> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    const result = await client.query<{ color_scheme: string }>(
      'SELECT color_scheme FROM "auth_user" WHERE email = $1',
      [email],
    );

    return result.rows[0]?.color_scheme;
  } finally {
    await client.end();
  }
}

/** Whether a unique index of that name exists in a database. */
export async function hasUniqueIndex(database: string, name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    const result = await client.query(
      "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1 AND indexdef LIKE 'CREATE UNIQUE INDEX%'",
      [name],
    );

    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}
