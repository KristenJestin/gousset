import { defineConfig, devices } from "@playwright/test";

import { harness } from "./src/config";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/**
 * Gousset's end-to-end harness (AGENTS.md, "Testing"): the built app, a database per worker, a
 * real browser. Locally one spec at a time (`pnpm e2e <file>`); CI runs the whole suite, sharded
 * (`pnpm e2e --shard=<i>/<n>`).
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./src/global-setup.ts",
  globalTeardown: "./src/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: harness.inCi,
  // A test that passes only on retry is a bug: recorded in Feedback and fixed, never retried.
  retries: 0,
  // Each worker runs its own app server and browser; two keep a shared machine usable.
  workers: 2,
  timeout: 30_000,
  // In CI each shard keeps its HTML report (playwright-report/) as an artifact on failure, and
  // `github` annotates the pull request.
  reporter: harness.inCi ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "Europe/Paris",
  },
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide" },
  },
  // A visual test names its screenshot with its theme (`month-dark`); browser and width come from
  // the project. A changed screenshot is reviewed in the pull request, never updated blindly.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}",
  // WebKit joins for the phone layout once CI runs it (issue #40).
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: DESKTOP } },
    { name: "chromium-phone", use: { ...devices["Desktop Chrome"], viewport: PHONE } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"], viewport: DESKTOP } },
    { name: "firefox-phone", use: { ...devices["Desktop Firefox"], viewport: PHONE } },
  ],
});
