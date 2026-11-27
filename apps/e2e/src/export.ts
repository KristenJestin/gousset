import { spawn } from "node:child_process";

import { request } from "@playwright/test";
import { Schema } from "effect";
import { strFromU8, unzipSync } from "fflate";

import type { TestUser } from "./auth";
import { databaseUrl } from "./database";

// The export of #22 as a test reads it, and the backup of an installation as its administrator
// makes and restores it (docs/releases.md, "Backing up and restoring").

// A row by its columns' names: a table of links (#37) has no `id`.
const Rows = Schema.Array(Schema.Record(Schema.String, Schema.Json));

const isText = Schema.is(Schema.String);

const Manifest = Schema.Struct({
  format: Schema.String,
  version: Schema.Number,
  about: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      rows: Schema.optional(Schema.Number),
      columns: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
    }),
  ),
});

/** An export's archive, unzipped: its files by path, its manifest, and a table's rows. */
export function readArchive(content: Uint8Array) {
  const files = unzipSync(content);

  const text = (path: string) => {
    const file = files[path];

    if (file === undefined) {
      throw new Error(`The archive has no ${path}.`);
    }

    return strFromU8(file);
  };

  /** The rows of `<file>.json`, each by its columns' names. */
  const rows = (file: string) => Schema.decodeUnknownSync(Rows)(JSON.parse(text(`${file}.json`)));

  return {
    files,
    text,
    manifest: Schema.decodeUnknownSync(Manifest)(JSON.parse(text("manifest.json"))),
    rows,
    /** The text of `column` in each row of `<file>.json`, where it is text: its ids, its owners. */
    texts: (file: string, column: string) =>
      rows(file).flatMap((row) => {
        const value = row[column];

        return isText(value) ? [value] : [];
      }),
  };
}

/** The user's export, downloaded from the app as their browser would, signed in. */
export async function downloadExport(baseURL: string, person: TestUser): Promise<Uint8Array> {
  const context = await request.newContext({
    baseURL,
    storageState: { cookies: [...person.cookies], origins: [] },
  });

  try {
    const answer = await context.get("/api/export");

    if (!answer.ok()) {
      throw new Error(`The export answered ${answer.status()}.`);
    }

    return new Uint8Array(await answer.body());
  } finally {
    await context.dispose();
  }
}

/**
 * Runs one of Postgres's own programs on a database, at the harness server's version, from its
 * image: a runner's or a machine's own `pg_dump` may be older than the server, which it refuses.
 * On the host's network, so that `localhost` is the harness's server; the password goes by name,
 * never on a command line. `input` goes to its standard input; its standard output comes back, as
 * `docker compose exec -T` gives them to the administrator.
 */
function postgresProgram(
  program: "pg_dump" | "pg_restore",
  database: string,
  args: ReadonlyArray<string>,
  input?: Uint8Array,
): Promise<Buffer> {
  const url = new URL(databaseUrl(database));
  const password = decodeURIComponent(url.password);

  url.password = "";

  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--interactive",
      "--network",
      "host",
      "--env",
      "PGPASSWORD",
      "postgres:18",
      program,
      `--dbname=${url.toString()}`,
      ...args,
    ],
    { env: { ...process.env, PGPASSWORD: password }, stdio: ["pipe", "pipe", "pipe"] },
  );

  const output: Array<Buffer> = [];
  const errors: Array<Buffer> = [];

  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  child.stdin.end(input);

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(output));
      } else {
        // Postgres's own words, the end of them: which object, which statement.
        const said = Buffer.concat(errors).toString("utf8").slice(-1500);

        reject(new Error(`${program} exited with ${String(code)}: ${said}`));
      }
    });
  });
}

/** Backs a database up as the administrator's documentation says: `pg_dump --format=custom`. */
export function dumpDatabase(database: string): Promise<Buffer> {
  return postgresProgram("pg_dump", database, ["--format=custom"]);
}

/**
 * Restores a dump into an empty database of a server whose roles exist, as the documentation
 * says: the whole dump in one transaction, stopping at its first error.
 */
export async function restoreDatabase(database: string, dump: Uint8Array): Promise<void> {
  await postgresProgram("pg_restore", database, ["--exit-on-error", "--single-transaction"], dump);
}
