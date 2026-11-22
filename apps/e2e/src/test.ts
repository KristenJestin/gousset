import { join } from "node:path";

import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import { expectAccessible } from "./accessibility";
import { startWorkerEnvironment } from "./app-server";
import type { AppEnvironment, WorkerEnvironment } from "./app-server";
import { addUser, madeUpUser, signUp } from "./auth";
import type { TestUser } from "./auth";
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
};

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

  userPage: async ({ page, user }, provide) => {
    await page.context().addCookies([...user.cookies]);
    await provide(page);
  },

  secondUserPage: async (
    { browser, secondUser, baseURL, viewport, colorScheme, locale, timezoneId },
    provide,
    testInfo,
  ) => {
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

export { SIGN_IN_PATH, SIGN_UP_PATH, createUser, signInStatus } from "./auth";

export { fixDay } from "./clock";

export { slowServerFunctions } from "./latency";

export { SKELETON, animationsDone, watchLoading } from "./loading";

export { connectMcp } from "./mcp";
