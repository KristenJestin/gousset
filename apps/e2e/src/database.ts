import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Schema } from "effect";
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

/** The drizzle-kit configuration that pushes Gousset's schema, reading its URL from the environment. */
const DRIZZLE_CONFIG = fileURLToPath(new URL("../drizzle.config.ts", import.meta.url));

/**
 * drizzle-kit runs in a process of its own: its SDK keeps a connection to the template open, and
 * Postgres refuses to copy a template in use.
 */
const DRIZZLE_KIT = fileURLToPath(new URL("../node_modules/.bin/drizzle-kit", import.meta.url));

/** The last line drizzle-kit prints with `--output json`. */
const PushAnswer = Schema.Struct({ status: Schema.String });

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
 * Pushes the schema into a database with drizzle-kit, and gives what it printed. The URL goes
 * through the environment, never the command line, where any local user could read its password.
 */
async function pushSchema(database: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      DRIZZLE_KIT,
      ["push", `--config=${DRIZZLE_CONFIG}`, "--force", "--output=json"],
      {
        // The configuration's paths are relative to apps/e2e.
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, E2E_SCHEMA_URL: databaseUrl(database) },
      },
    );

    return stdout;
  } catch {
    throw new Error(
      `drizzle-kit could not push the schema into ${database}: run \`pnpm db:push\` against it to see why.`,
    );
  }
}

/**
 * Builds the template: the schema, then the shared made-up data of `packages/fixture`. There are
 * no migrations yet, so the schema is pushed; once `packages/db` has migrations, this applies them
 * instead, the way an installation does.
 */
export async function prepareTemplate(): Promise<void> {
  const template = templateDatabase();

  await recreateDatabase(template);

  const stdout = await pushSchema(template);
  const lastLine = stdout.trim().split("\n").at(-1) ?? "";
  const answer = Schema.decodeUnknownSync(Schema.fromJsonString(PushAnswer))(lastLine);

  if (answer.status !== "ok" && answer.status !== "no_changes") {
    throw new Error(`The schema could not be pushed into ${template}: ${lastLine}`);
  }

  // The fixture's seed goes here once Gousset has tables of its own beyond the accounts of
  // better-auth: the template is the one place it is written, every worker gets a copy.
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
    const result = await client.query('SELECT 1 FROM "user" WHERE email = $1', [email]);

    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}
