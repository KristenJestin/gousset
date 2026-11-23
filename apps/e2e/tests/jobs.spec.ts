import type { Page } from "@playwright/test";

import { expect, test, visit } from "../src/test";

// The scenarios of issue #14, "How to verify", one test each, plus the issue's other promises: a
// job's end reads again what it touched, and nobody else follows a user's job. The test job and
// its page (`/e2e/jobs`) exist only in the harness's app (apps/web/src/jobs/test-job.ts).

const PAGE = "/e2e/jobs";

/** The test job's three attempts all fail on purpose, one second apart: well within this. */
const FAILING_TIMEOUT_MS = 30_000;

type Run = { count: number; itemMs: number; failures: number };

const status = (page: Page) => page.locator('[data-slot="job-progress-status"]');
const currentStep = (page: Page) => page.locator('li[aria-current="step"]');

/** Sends the test job from its page, and waits until the page follows it. */
async function startTestJob(page: Page, run: Run): Promise<string> {
  await page.getByLabel("Items to count").fill(String(run.count));
  await page.getByLabel("Milliseconds per item").fill(String(run.itemMs));
  await page.getByLabel("Attempts that fail").fill(String(run.failures));
  await page.getByRole("button", { name: "Start the test job" }).click();
  await expect(page).toHaveURL(/[?&]job=/);

  return new URL(page.url()).searchParams.get("job") ?? "";
}

// What the server does does not depend on the browser or the screen width: the progress display's
// own drawing is checked in packages/ui. One project is enough, as for the server's telemetry.
// oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, even when there are none.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "the server's jobs, checked once");
});

test("a test job reports its steps to a test page", async ({ userPage: page }) => {
  await visit(page, PAGE);
  await startTestJob(page, { count: 4, itemMs: 700, failures: 0 });

  // Each step as the job reports it, and each item it counts, in order.
  await expect(status(page)).toHaveText("Step 1 of 3", { timeout: 10_000 });
  await expect(currentStep(page)).toContainText("Preparing");
  await expect(status(page)).toHaveText("Step 2 of 3");
  await expect(currentStep(page)).toContainText("Counting the items");

  for (const done of [1, 2, 3]) {
    await expect(currentStep(page)).toContainText(`${String(done)} of 4`);
  }

  await expect(status(page)).toHaveText("Done", { timeout: 10_000 });
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("Every item counted.")).toBeVisible();
  await expect(page.locator('li[data-state="done"]')).toHaveCount(3);
});

test("a job that fails is retried, then shown failed", async ({ userPage: page }) => {
  await visit(page, PAGE);
  await startTestJob(page, { count: 1, itemMs: 100, failures: 3 });

  // Its first attempt fails at the last step: the next one is planned, a second later.
  await expect(status(page)).toHaveText("Retrying: attempt 2 of 3", {
    timeout: FAILING_TIMEOUT_MS,
  });
  await expect(page.locator('li[data-state="stopped"]')).toContainText("Finishing");

  // Its third and last attempt fails too: failed for good, saying what to do.
  await expect(status(page)).toHaveText("Failed after 3 attempts", {
    timeout: FAILING_TIMEOUT_MS,
  });
  // The progress block's own alert: ui-sdk's announcer is another, empty, on every page.
  await expect(page.locator('[data-slot="job-progress"]').getByRole("alert")).toContainText(
    "The test job failed on purpose, as asked. Start it again with fewer failing attempts.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  // Read again from the queue's own row: the page says the same.
  await page.reload();
  await expect(status(page)).toHaveText("Failed after 3 attempts");
});

test("a restart of the app resumes the queue", async ({ userPage: page, app }) => {
  // Fifteen seconds of counting, a stop that waits five, a start, and the job again.
  test.setTimeout(120_000);

  await visit(page, PAGE);
  await startTestJob(page, { count: 30, itemMs: 500, failures: 0 });
  await expect(currentStep(page)).toContainText("2 of 30", { timeout: 10_000 });

  // The job is far from done; the app stops (SIGTERM, as `docker stop` sends it) and starts again.
  await app.restart();

  // The page's stream comes back by itself, and the job, resumed by the new app, ends.
  await expect(status(page)).toHaveText("Done", { timeout: 90_000 });

  // The queue's row says so too.
  await page.reload();
  await expect(status(page)).toHaveText("Done");
});

test("a job's end reads again the month it touched", async ({ userPage: page }) => {
  await visit(page, PAGE);
  await expect(page.getByText("Received")).toBeVisible();

  const reads: Array<string> = [];

  page.on("request", (request) => {
    const url = decodeURIComponent(request.url());

    if (url.includes("/_serverFn/") && url.includes("2026-10")) {
      reads.push(url);
    }
  });

  await startTestJob(page, { count: 1, itemMs: 100, failures: 0 });
  await expect(status(page)).toHaveText("Done", { timeout: 10_000 });

  // October, which the job says it touched, is read again once it is done.
  await expect.poll(() => reads.length).toBeGreaterThan(0);
});

test("nobody else follows a user's job", async ({ userPage: page, secondUserPage, baseURL }) => {
  await visit(page, PAGE);

  const id = await startTestJob(page, { count: 1, itemMs: 100, failures: 0 });
  const events = `/api/jobs/${id}/events`;

  await expect(status(page)).toHaveText("Done", { timeout: 10_000 });

  // Another user of the same installation: not found, as any id that is not theirs.
  const other = await secondUserPage.request.get(events);

  expect(other.status()).toBe(404);

  // Nobody signed in: refused.
  const anonymous = await fetch(new URL(events, baseURL));

  expect(anonymous.status).toBe(401);

  // Its owner reads its end, as a Server-Sent Event.
  const own = await page.request.get(events);

  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toContain("text/event-stream");
  expect(await own.text()).toContain('"phase":"completed"');
});
