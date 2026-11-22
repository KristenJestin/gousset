import { setTimeout as sleep } from "node:timers/promises";

import type { Page } from "@playwright/test";

import { SERVER_FUNCTIONS } from "../src/latency";
import {
  SKELETON,
  animationsDone,
  expect,
  fixDay,
  slowServerFunctions,
  test,
  visit,
  watchLoading,
} from "../src/test";

// The scenarios of issue #9, "How to verify", one test each, plus the issue's other promises:
// month changes, preloading and the skeleton's motion. Every block reads the made-up month of
// packages/fixture; October 2026 is a whole month whatever the day of the run.

const MONTH = "/?month=2026-10";
const BLOCKS = ["The month", "Where the money goes", "To review"];
const LATENCY_MS = 1500;

const block = (page: Page, title: string) => page.getByRole("region", { name: title });

/** Leaves the review for a page that links back to it, so that the way back is a client navigation. */
async function openUsersPage(page: Page) {
  await visit(page, "/users");
}

test("the first visit shows no skeleton", async ({ userPage: page }) => {
  const counts = await watchLoading(page);

  // The page as the server sent it, before any script ran: filled in.
  const rendered = await page.request.get(MONTH);
  const html = await rendered.text();

  expect(rendered.ok()).toBe(true);
  expect(html).toContain("Housing");
  expect(html).not.toContain('aria-busy="true"');

  await visit(page, MONTH);

  for (const title of BLOCKS) {
    await expect(block(page, title)).toBeVisible();
  }

  await expect(block(page, "Where the money goes")).toContainText("Housing");
  await expect(page.locator(SKELETON)).toHaveCount(0);
  expect((await counts()).skeletons).toBe(0);
});

test("with latency on, each block shows its own skeleton and the page's layout does not shift when data arrives", async ({
  userPage: page,
}) => {
  // The review opens on today's month: the last day of October, a whole month.
  await fixDay(page, "2026-10-31");

  const counts = await watchLoading(page);

  await openUsersPage(page);
  await slowServerFunctions(page, LATENCY_MS);
  await page.getByRole("link", { name: "Back" }).click();

  for (const title of BLOCKS) {
    await expect(block(page, title).getByRole("status", { name: "Loading" })).toBeVisible();
  }

  // Shown only after about 150 ms, then faded in.
  const skeleton = page.locator(SKELETON).first();

  await expect(skeleton).toHaveCSS("animation-delay", "0.15s");
  await expect(skeleton).toHaveCSS("animation-duration", "0.2s");

  const whileLoading = await Promise.all(BLOCKS.map((title) => block(page, title).boundingBox()));
  // From here on: the navigation itself (one page giving way to the other) is not what is measured.
  const before = await counts();

  await expect(block(page, "Where the money goes")).toContainText("Housing", { timeout: 10_000 });
  await expect(page.locator(SKELETON)).toHaveCount(0);

  const loaded = await Promise.all(BLOCKS.map((title) => block(page, title).boundingBox()));

  // Each skeleton has its block's exact shape: nothing moved.
  expect(loaded).toEqual(whileLoading);

  const after = await counts();

  expect(after.skeletons).toBeGreaterThan(0);
  // Chromium measures it; Firefox has no layout-shift entries (`null` before and after).
  expect(after.layoutShift).toBe(before.layoutShift);
  await animationsDone(page);
});

test("under reduced motion a skeleton appears without its fade", async ({ userPage: page }) => {
  await fixDay(page, "2026-10-31");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openUsersPage(page);
  await slowServerFunctions(page, LATENCY_MS);
  await page.getByRole("link", { name: "Back" }).click();

  const skeleton = page.locator(SKELETON).first();

  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveCSS("animation-duration", "0s");
  await expect(page.locator(SKELETON)).toHaveCount(0, { timeout: 10_000 });
});

test("a refused mutation rolls back", async ({ userPage: page }) => {
  await visit(page, MONTH);

  const toReview = block(page, "To review");
  const approve = toReview.getByRole("button", { name: /^Approve / }).first();
  const name = (await approve.getAttribute("aria-label")) ?? "";
  const line = toReview.getByRole("listitem").filter({ has: page.getByRole("button", { name }) });

  await expect(line).toHaveCount(1);

  // The server refuses the approval, a second after it is asked: reads still go through.
  await page.route(SERVER_FUNCTIONS, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();

      return;
    }

    await sleep(1000);
    await route.fulfill({ status: 500, body: "Refused by the test." });
  });

  await approve.click();

  // Folded away at once, before the server answers…
  await expect(line).toHaveCount(0);

  // …then put back, with a message that says so.
  const toast = page.getByRole("alert");

  await expect(toast).toContainText("Something went wrong");
  await expect(toast).toContainText("The line could not be approved; it is back in the list.");
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(line).toHaveCount(1);
});

test("an error stays in its block, with a retry, and the rest of the page works", async ({
  userPage: page,
}) => {
  await fixDay(page, "2026-10-31");
  await openUsersPage(page);

  // Only the spending block's reads fail (they ask for it by category), until the test lets them.
  let failing = true;

  await page.route(SERVER_FUNCTIONS, async (route) => {
    if (failing && decodeURIComponent(route.request().url()).includes("category")) {
      await route.fulfill({ status: 500, body: "Failed by the test." });

      return;
    }

    await route.fallback();
  });

  await page.getByRole("link", { name: "Back" }).click();

  const spending = block(page, "Where the money goes");

  await expect(spending.getByRole("alert")).toContainText("This block could not be loaded", {
    timeout: 10_000,
  });
  // The other blocks have their data, and their actions still work.
  await expect(block(page, "The month")).toContainText("Received");
  await expect(block(page, "To review").getByRole("button", { name: /^Approve / })).toHaveCount(3);

  failing = false;
  await spending.getByRole("button", { name: "Try again" }).click();

  await expect(spending).toContainText("Housing");
  await expect(spending.getByRole("alert")).toHaveCount(0);
  // Faded in: axe measures its contrast at the end of the test.
  await animationsDone(page);
});

test("changing month keeps the current data on screen while the next one loads", async ({
  userPage: page,
}) => {
  const counts = await watchLoading(page);

  await visit(page, MONTH);

  const spending = block(page, "Where the money goes");
  const october = await spending.textContent();

  await slowServerFunctions(page, LATENCY_MS);
  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-09/);

  // September is on its way; October stays on screen, without a skeleton.
  expect(await spending.textContent()).toBe(october);
  await expect(page.getByText("October 2026")).toBeVisible();

  await expect(page.getByText("September 2026")).toBeVisible({ timeout: 10_000 });
  expect(await spending.textContent()).not.toBe(october);
  expect((await counts()).skeletons).toBe(0);
});

test("a link preloads its route on hover and on focus", async ({ userPage: page }) => {
  await visit(page, MONTH);

  const asked: Array<string> = [];

  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) {
      asked.push(decodeURIComponent(request.url()));
    }
  });

  await page.getByRole("link", { name: "Previous month" }).hover();
  await expect.poll(() => asked.some((url) => url.includes("2026-09"))).toBe(true);

  await page.getByRole("link", { name: "Next month" }).focus();
  await expect.poll(() => asked.some((url) => url.includes("2026-11"))).toBe(true);

  // Nothing was clicked: still October.
  await expect(page).toHaveURL(/month=2026-10/);
});
