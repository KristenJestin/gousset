import { defineConfig, devices } from "@playwright/test";

// The theme's browser checks run against Storybook, headless, one at a time. The app's own
// end-to-end harness (the built app, Postgres) lives elsewhere; this only needs the stories.
// They run on a fresh static build: the dev server re-optimises its dependencies on a first
// visit and reloads the page under the test.
const PORT = 6106;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `storybook build --quiet && vp preview --outDir storybook-static --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
