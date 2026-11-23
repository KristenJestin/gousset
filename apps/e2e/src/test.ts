import { join } from "node:path";

import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import { expectAccessible } from "./accessibility";
import { startWorkerEnvironment } from "./app-server";
import type { AppEnvironment, WorkerEnvironment } from "./app-server";
import { addUser, hasLiveSession, madeUpUser, signUp } from "./auth";
import type { TestUser } from "./auth";
import { TEST_CLIENT_ID, registerTestClient } from "./oauth-client";
import { writeStatements } from "./statements";
import type { StatementPaths } from "./statements";

type WorkerFixtures = {
  /**
   * Variables added to this worker's app, none by default. A spec that needs others overrides it,
   * with `test.use` for fixed values or `test.extend` for values another fixture computes (the
   * address of a collector it started).
   */
  appEnvironment: AppEnvironment;
  /** This worker's app, on its own database cloned from the template. */
  app: WorkerEnvironment;
  /** The first user of the worker's app, signed up through the first visit: the administrator. */
  user: TestUser;
  /**
   * Another user of the same installation, created by the administrator, temporary password
   * already changed: to prove one never sees the other's data.
   */
  secondUser: TestUser;
};

type TestFixtures = {
  /** The test's page, signed in as `user`. */
  userPage: Page;
  /** A page of its own, in its own browser context, signed in as `secondUser`. */
  secondUserPage: Page;
  /** The made-up example statement, written in every format for this test. */
  statements: StatementPaths;
  /** axe on the screen each page ends on, once the test has passed. */
  accessibilityAtTheEnd: void;
  /**
   * The harness's MCP client, registered with the worker's app, nothing allowed yet: every test
   * goes through the consent page (`registerTestClient`).
   */
  mcpClientId: string;
};

/**
 * The worker's users keep one session each, shared by every test of the worker: a test that ended
 * it (signed out) would send every later test to the sign-in page, and fail there far from the
 * cause. Checked before each test that uses it.
 */
async function expectSharedSession(baseURL: string, person: TestUser): Promise<void> {
  if (!(await hasLiveSession(baseURL, person))) {
    throw new Error(
      `A previous test ended the shared session of ${person.email}: a test that signs out must sign in with a session of its own (signIn in src/auth.ts).`,
    );
  }
}

async function expectAccessibleIfOpen(page: Page): Promise<void> {
  if (page.isClosed() || page.url() === "about:blank") {
    return;
  }

  await expectAccessible(page);
}

// Playwright calls a fixture's second argument `use`; it is named `provide` here so that the
// React hook rules do not read it as a hook.
export const test = base.extend<TestFixtures, WorkerFixtures>({
  appEnvironment: [{}, { scope: "worker", option: true }],

  app: [
    async ({ appEnvironment }, provide, workerInfo) => {
      const slot = workerInfo.parallelIndex;

      const logFile = join(
        workerInfo.project.outputDir,
        `app-${workerInfo.project.name}-worker-${slot}.log`,
      );

      const app = await startWorkerEnvironment(slot, logFile, appEnvironment);

      try {
        await provide(app);
      } finally {
        await app.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],

  baseURL: async ({ app }, provide) => {
    await provide(app.baseURL);
  },

  user: [
    async ({ app }, provide) => {
      await provide(await signUp(app.baseURL, madeUpUser("first", app.slot)));
    },
    { scope: "worker" },
  ],

  secondUser: [
    async ({ app, user }, provide) => {
      await provide(await addUser(app.baseURL, user, madeUpUser("second", app.slot)));
    },
    { scope: "worker" },
  ],

  mcpClientId: async ({ app }, provide) => {
    await registerTestClient(app.database, app.baseURL);
    await provide(TEST_CLIENT_ID);
  },

  userPage: async ({ page, user, app }, provide) => {
    await expectSharedSession(app.baseURL, user);
    await page.context().addCookies([...user.cookies]);
    await provide(page);
  },

  secondUserPage: async (
    { browser, secondUser, app, baseURL, viewport, colorScheme, locale, timezoneId },
    provide,
    testInfo,
  ) => {
    await expectSharedSession(app.baseURL, secondUser);

    const context = await browser.newContext({
      baseURL,
      viewport,
      colorScheme,
      locale,
      timezoneId,
    });

    await context.addCookies([...secondUser.cookies]);

    const page = await context.newPage();

    try {
      await provide(page);

      if (testInfo.status === testInfo.expectedStatus) {
        await expectAccessibleIfOpen(page);
      }
    } finally {
      await context.close();
    }
  },

  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, even when there are none.
  statements: async ({}, provide, testInfo) => {
    await provide(await writeStatements(testInfo.outputPath("statements")));
  },

  accessibilityAtTheEnd: [
    async ({ page }, provide, testInfo) => {
      await provide();

      if (testInfo.status === testInfo.expectedStatus) {
        await expectAccessibleIfOpen(page);
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

export { expectAccessible, visit } from "./accessibility";

export {
  SIGN_IN_PATH,
  SIGN_UP_PATH,
  addUser,
  createUser,
  personOfItsOwn,
  signIn,
  signInStatus,
} from "./auth";

export { fixDay } from "./clock";

export { slowServerFunctions } from "./latency";

export { SKELETON, animationsDone, watchLoading } from "./loading";

export { connectMcp } from "./mcp";

export type { McpSession, Revision } from "./mcp";
