import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { Schema } from "effect";

import { harness } from "./config";
import {
  databaseUrl,
  dropDatabase,
  recreateDatabase,
  templateDatabase,
  workerDatabaseName,
} from "./database";

const WEB_APP = fileURLToPath(new URL("../../web", import.meta.url));
const BUILT_SERVER = ".output/server/index.mjs";
const STARTUP_TIMEOUT_MS = 60_000;

/** Where every worker's app listens; `fixDay` sets its cookie for this host. */
export const APP_HOST = "127.0.0.1";

/**
 * A test-only secret: the app runs in production mode, where better-auth refuses to start
 * without one. It signs nothing outside a test run.
 */
const TEST_AUTH_SECRET = "e2e-only-secret-never-used-outside-the-test-run";

/** One worker's app: its own server, on its own port, against its own database. */
export type WorkerEnvironment = {
  slot: number;
  database: string;
  baseURL: string;
  /**
   * Stops the app as `docker stop` would (SIGTERM, then SIGKILL after 10 s) and starts it again on
   * the same port and database, resolving once it serves: what a restart of an installation does.
   */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
};

/** What a TCP server listening on a port says of its address. */
const ListeningAddress = Schema.Struct({ port: Schema.Number });

async function freePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = Schema.decodeUnknownSync(ListeningAddress)(server.address());

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  return port;
}

/** Variables a test adds to its worker's app (`appEnvironment` in `src/test.ts`). */
export type AppEnvironment = Readonly<Record<string, string>>;

function appEnvironment(port: number, database: string, extra: AppEnvironment) {
  return {
    ...extra,
    NODE_ENV: "production",
    HOST: APP_HOST,
    PORT: String(port),
    BETTER_AUTH_URL: `http://${APP_HOST}:${port}`,
    BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
    DATABASE_URL: databaseUrl(database),
    // The server's clock reads the day `fixDay` sets (README, "The server's clock").
    GOUSSET_E2E_CLOCK: "on",
    // `/mcp` serves its test-only write action, `e2e_probe` (packages/mcp, tools/e2e-probe.ts).
    GOUSSET_E2E_PROBE: "on",
    // The test job and its page, `/e2e/jobs` (apps/web/src/jobs/test-job.ts).
    GOUSSET_E2E_JOBS: "on",
  };
}

/** The built server (`pnpm build`), or the image named by `E2E_APP_IMAGE`. */
function launch(
  port: number,
  database: string,
  container: string,
  extra: AppEnvironment,
): ChildProcess {
  const environment = appEnvironment(port, database, extra);

  if (harness.appImage !== undefined) {
    // Each variable by name only: docker takes its value from its own environment, so that the
    // database password never sits on a command line any local user can read.
    const variables = Object.keys(environment).flatMap((name) => ["--env", name]);

    return spawn(
      "docker",
      ["run", "--rm", "--network", "host", "--name", container, ...variables, harness.appImage],
      { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] },
    );
  }

  if (!existsSync(`${WEB_APP}/${BUILT_SERVER}`)) {
    throw new Error(
      `apps/web is not built: run \`pnpm build\` first (the harness tests ${BUILT_SERVER}).`,
    );
  }

  return spawn(process.execPath, [BUILT_SERVER], {
    cwd: WEB_APP,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A launched app, followed from its spawn: an exit by a signal counts as much as one by a code. */
type Launched = {
  server: ChildProcess;
  isRunning: () => boolean;
  exited: Promise<void>;
};

function follow(server: ChildProcess): Launched {
  let running = true;

  const exited = new Promise<void>((resolve) => {
    const done = () => {
      running = false;
      resolve();
    };

    server.once("exit", done);
    // A program that could not start at all (docker missing) never sends `exit`.
    server.once("error", done);
  });

  return { server, isRunning: () => running, exited };
}

async function waitUntilServing(baseURL: string, app: Launched, logFile: string) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!app.isRunning()) {
      throw new Error(`The app stopped while starting; see ${logFile}.`);
    }

    try {
      const response = await fetch(baseURL);

      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }

    await sleep(250);
  }

  throw new Error(`The app did not answer on ${baseURL} within 60 s; see ${logFile}.`);
}

async function stopProcess(app: Launched, container: string): Promise<void> {
  if (harness.appImage !== undefined) {
    // Whatever became of the `docker run` client: a client killed outright leaves its container
    // running, and only `docker stop` ends it.
    const stopping = spawn("docker", ["stop", container], { stdio: "ignore" });

    await new Promise<void>((resolve) => {
      stopping.once("exit", () => resolve());
      stopping.once("error", () => resolve());
    });
  }

  if (!app.isRunning()) {
    return;
  }

  if (harness.appImage === undefined) {
    app.server.kill("SIGTERM");
  }

  const stopped = await Promise.race([
    app.exited.then(() => true),
    sleep(10_000).then(() => false),
  ]);

  if (!stopped) {
    app.server.kill("SIGKILL");
  }
}

/**
 * Clones the template into the slot's database, then starts the app on it. Its output goes to
 * `logFile`, kept with the run's results.
 */
export async function startWorkerEnvironment(
  slot: number,
  logFile: string,
  extra: AppEnvironment = {},
): Promise<WorkerEnvironment> {
  const database = workerDatabaseName(slot);

  await recreateDatabase(database, templateDatabase());

  return startApp(slot, database, logFile, extra);
}

/**
 * Starts an app on a database that is ready (a backup restored into it, say), on a port of its
 * own. Stopping it drops the database.
 */
export async function startApp(
  slot: number,
  database: string,
  logFile: string,
  extra: AppEnvironment = {},
): Promise<WorkerEnvironment> {
  const port = await freePort();
  const baseURL = `http://${APP_HOST}:${port}`;

  mkdirSync(dirname(logFile), { recursive: true });

  // Appended: a worker that replaces a failed one on the same slot keeps the failed one's log.
  const log = createWriteStream(logFile, { flags: "a" });
  let launches = 0;

  // A container's name of its own at each launch: a stopped one may not be removed yet.
  const start = () => {
    launches += 1;

    const container = `gousset-e2e-${port}-${launches}`;
    const launched = follow(launch(port, database, container, extra));

    launched.server.stdout?.pipe(log, { end: false });
    launched.server.stderr?.pipe(log, { end: false });

    return { launched, container };
  };

  let app = start();

  const stop = async () => {
    await stopProcess(app.launched, app.container);
    log.end();
    await dropDatabase(database);
  };

  const restart = async () => {
    await stopProcess(app.launched, app.container);
    app = start();
    await waitUntilServing(baseURL, app.launched, logFile);
  };

  try {
    await waitUntilServing(baseURL, app.launched, logFile);
  } catch (error) {
    await stop();
    throw error;
  }

  return { slot, database, baseURL, restart, stop };
}
