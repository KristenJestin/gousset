import { startWorkerEnvironment } from "../src/app-server";
import { madeUpUser, signInStatus, signUp } from "../src/auth";
import {
  databaseExists,
  dropDatabase,
  hasUser,
  newRunId,
  recreateDatabase,
  templateDatabase,
  workerDatabaseName,
} from "../src/database";
import { expect, test } from "../src/test";

// Two workers running at once never read each other's data (issue #40, "How to verify"). The
// second worker is started here, the way every worker starts its own, so that the test does not
// depend on how the run schedules or shards its tests.
test("two workers running at once never read each other's data", async ({
  app,
  user,
}, testInfo) => {
  test.setTimeout(120_000);

  const other = await startWorkerEnvironment(
    app.slot + 100,
    testInfo.outputPath("other-worker.log"),
  );

  try {
    const otherUser = await signUp(other.baseURL, madeUpUser("first", other.slot));

    expect(other.database).not.toBe(app.database);
    expect(other.baseURL).not.toBe(app.baseURL);

    // Read straight from the databases: each holds its own worker's user, never the other's.
    expect(await hasUser(app.database, user.email)).toBe(true);
    expect(await hasUser(app.database, otherUser.email)).toBe(false);
    expect(await hasUser(other.database, otherUser.email)).toBe(true);
    expect(await hasUser(other.database, user.email)).toBe(false);

    // Through the apps: each user signs in to their own worker's app and to no other.
    expect(await signInStatus(app.baseURL, user)).toBe(200);
    expect(await signInStatus(other.baseURL, otherUser)).toBe(200);
    expect(await signInStatus(app.baseURL, otherUser)).toBe(401);
    expect(await signInStatus(other.baseURL, user)).toBe(401);
  } finally {
    await other.stop();
  }
});

// Two runs on one Postgres (two worktrees on `pnpm db:start`) never drop each other's databases:
// this run creates and drops a worker's database on the very slot another run is using.
test("two runs on one database server never drop each other's databases", async ({
  app,
}, testInfo) => {
  test.setTimeout(120_000);

  const slot = app.slot + 200;
  const otherRuns = workerDatabaseName(slot, newRunId());

  await recreateDatabase(otherRuns, templateDatabase());

  try {
    const ours = await startWorkerEnvironment(slot, testInfo.outputPath("same-slot-worker.log"));

    try {
      expect(ours.database).not.toBe(otherRuns);
    } finally {
      // Stopped whatever happens, so that a failing test leaves no app nor database behind.
      await ours.stop();
    }

    expect(await databaseExists(ours.database)).toBe(false);
    expect(await databaseExists(otherRuns)).toBe(true);
  } finally {
    await dropDatabase(otherRuns);
  }
});
