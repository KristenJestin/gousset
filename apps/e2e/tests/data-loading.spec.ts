import { setTimeout as sleep } from "node:timers/promises";

import type { Page } from "@playwright/test";

import { openAccountMenu } from "../src/frame";
import { SERVER_FUNCTIONS } from "../src/latency";
import { closeBlock, openBlock } from "../src/review";
import {
  SKELETON,
  animationsDone,
  expect,
  fixDay,
  signIn,
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
const SLOW_MONTH_MS = 6000;

const block = (page: Page, title: string) => page.getByRole("region", { name: title });

/** The month switcher beside the page's title. */
const monthSwitcher = (page: Page) => page.getByRole("group", { name: "Month", exact: true });

const errorToast = (page: Page) =>
  page
    .getByRole("region", { name: "Notifications" })
    .locator('[data-slot="toast"][data-type="error"]');

/** Leaves the review for another screen, so that the way back is a client navigation. */
async function openUsersPage(page: Page) {
  await visit(page, "/settings/users");
}

/** Back to the review through the frame's link, the sidebar's or the tab bar's. */
async function backToReview(page: Page) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Review" })
    .click();
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
  await backToReview(page);

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
  await backToReview(page);

  const skeleton = page.locator(SKELETON).first();

  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveCSS("animation-duration", "0s");
  await expect(page.locator(SKELETON)).toHaveCount(0, { timeout: 10_000 });
});

test("a refused mutation rolls back", async ({ userPage: page }) => {
  await visit(page, MONTH);

  const toReview = await openBlock(page, "To review");
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

  // On a phone, the page's toast is read with the sheet closed.
  await closeBlock(page);

  // …then put back, with a message that says so: an error toast in the Notifications landmark
  // (packages/ui's toaster; ui-sdk announces it assertively through its own live region).
  const toast = errorToast(page);

  await expect(toast).toContainText("Something went wrong");
  await expect(toast).toContainText("The line could not be approved; it is back in the list.");
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  await openBlock(page, "To review");
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

  await backToReview(page);

  const spending = block(page, "Where the money goes");

  await expect(spending.getByRole("alert")).toContainText("This block could not be loaded", {
    timeout: 10_000,
  });
  // The other blocks have their data, and their actions still work.
  await expect(block(page, "The month")).toContainText("received");
  await expect(
    (await openBlock(page, "To review")).getByRole("button", { name: /^Approve / }),
  ).toHaveCount(3);
  await closeBlock(page);

  failing = false;
  await spending.getByRole("button", { name: "Try again" }).click();

  await expect(spending).toContainText("Housing");
  await expect(spending.getByRole("alert")).toHaveCount(0);
  // Faded in: axe measures its contrast at the end of the test.
  await animationsDone(page);
});

test("a block that failed shows the next month once the month changes", async ({
  userPage: page,
}) => {
  await fixDay(page, "2026-10-31");
  await openUsersPage(page);

  // Only October's spending fails.
  await page.route(SERVER_FUNCTIONS, async (route) => {
    const url = decodeURIComponent(route.request().url());

    if (url.includes("category") && url.includes("2026-10")) {
      await route.fulfill({ status: 500, body: "Failed by the test." });

      return;
    }

    await route.fallback();
  });

  await backToReview(page);

  const spending = block(page, "Where the money goes");

  await expect(spending.getByRole("alert")).toBeVisible({ timeout: 10_000 });

  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();

  await expect(monthSwitcher(page)).toContainText("September 2026", { timeout: 10_000 });
  await expect(spending).toContainText("Housing");
  await expect(spending.getByRole("alert")).toHaveCount(0);
  await animationsDone(page);
});

test("a line already reviewed elsewhere is refused, and stays reviewed", async ({
  userPage: page,
}) => {
  // A month of its own: the approval below changes this user's August for the rest of the run.
  const august = "/?month=2026-08";

  await visit(page, august);

  const toReview = block(page, "To review");

  await expect(toReview).toContainText("Show the other 3");

  // The same line, approved first in another tab of the same session.
  const other = await page.context().newPage();

  try {
    await visit(other, august);

    const approved = other.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes("/_serverFn/"),
    );

    await (
      await openBlock(other, "To review")
    )
      .getByRole("button", { name: /^Approve / })
      .first()
      .click();
    await approved;
  } finally {
    await other.close();
  }

  // This tab still shows it: the server refuses, says why, and the line stays away.
  await (
    await openBlock(page, "To review")
  )
    .getByRole("button", { name: /^Approve / })
    .first()
    .click();
  await closeBlock(page);

  await expect(errorToast(page)).toContainText("This line was already reviewed elsewhere.");
  await expect(toReview).toContainText("Show the other 2");
});

test("a user who signs in after another in the same tab never sees the other's data", async ({
  page,
  user,
  secondUser,
  baseURL,
}) => {
  // The first user signs out below: in a session of their own, never the worker's shared one,
  // which every later test of the worker uses.
  const own = await signIn(baseURL ?? "", user);

  await page.context().addCookies([...own.cookies]);

  // July is this test's own month: the review opens on it.
  await fixDay(page, "2026-07-31");
  await visit(page, "/");

  const toReview = block(page, "To review");

  await expect(toReview).toContainText("Show the other 3");

  // The first user approves a line: their list has one line less.
  const approved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/_serverFn/"),
  );

  await (
    await openBlock(page, "To review")
  )
    .getByRole("button", { name: /^Approve / })
    .first()
    .click();
  await approved;
  await closeBlock(page);
  await expect(toReview).toContainText("Show the other 2");

  // They sign out, and the second user signs in, in the same tab: no reload anywhere.
  await page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "yes";
  });
  const menu = await openAccountMenu(page, user.name);

  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("E-mail").fill(secondUser.email);
  await page.getByLabel("Password", { exact: true }).fill(secondUser.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoReload)).toBe("yes");

  // Their own July: every line still to review, not the first user's list.
  await expect(toReview).toContainText("Show the other 3");
  await animationsDone(page);
});

test("changing month keeps the current data on screen while the next one loads", async ({
  userPage: page,
}) => {
  const counts = await watchLoading(page);

  // The first paint is the server's; the browser's calls, September's among them, are slowed.
  // Long enough for the press to come while September is still on its way.
  await slowServerFunctions(page, SLOW_MONTH_MS);
  await visit(page, MONTH);

  const spending = block(page, "Where the money goes");
  const october = await spending.textContent();

  // September is on its way (the page asked for it ahead, slowed down); October stays on screen,
  // without a skeleton, and so does its name.
  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  expect(await spending.textContent()).toBe(october);
  await expect(monthSwitcher(page)).toContainText("October 2026");

  await expect(monthSwitcher(page)).toContainText("September 2026", {
    timeout: SLOW_MONTH_MS + 10_000,
  });
  expect(await spending.textContent()).not.toBe(october);
  expect((await counts()).skeletons).toBe(0);
});

/** Records the server functions a page asks for from now on. */
function recordAsked(page: Page) {
  const asked: Array<string> = [];

  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) {
      asked.push(decodeURIComponent(request.url()));
    }
  });

  return asked;
}

test("the months either side are loaded before the switcher is pressed", async ({
  userPage: page,
}) => {
  const asked = recordAsked(page);

  await visit(page, MONTH);

  await expect.poll(() => asked.some((url) => url.includes("2026-09"))).toBe(true);
  await expect.poll(() => asked.some((url) => url.includes("2026-11"))).toBe(true);

  // Nothing was pressed: still October.
  await expect(page).toHaveURL(/month=2026-10/);
});

/** Opens a screen without the review's data, and records the server functions asked after. */
async function fromAccounts(page: Page) {
  await visit(page, "/accounts");

  return recordAsked(page);
}

test("a link preloads its route on hover and on focus", async ({ userPage: page }) => {
  // The review opens on today's month, October.
  await fixDay(page, "2026-10-31");

  const hovered = await fromAccounts(page);

  await page.getByRole("link", { name: "Review" }).hover();
  await expect.poll(() => hovered.some((url) => url.includes("2026-10"))).toBe(true);

  const other = await page.context().newPage();

  try {
    await fixDay(other, "2026-10-31");

    const focused = await fromAccounts(other);

    await other.getByRole("link", { name: "Review" }).focus();
    await expect.poll(() => focused.some((url) => url.includes("2026-10"))).toBe(true);
  } finally {
    await other.close();
  }

  // Nothing was clicked: still on the accounts.
  await expect(page).toHaveURL(/\/accounts$/);
});
