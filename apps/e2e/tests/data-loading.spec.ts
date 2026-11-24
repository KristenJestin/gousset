import type { Page } from "@playwright/test";
import { account, statementLine } from "@gousset/db/schema/ledger";

import type { TestUser } from "../src/auth";
import { openAccountMenu } from "../src/frame";
import { SERVER_FUNCTIONS } from "../src/latency";
import {
  SKELETON,
  addUser,
  animationsDone,
  expect,
  fixDay,
  personOfItsOwn,
  signIn,
  slowServerFunctions,
  test,
  visit,
  watchLoading,
} from "../src/test";
import { openUserData } from "../src/user-data";

// The scenarios of issue #9, "How to verify", one test each, plus the issue's other promises:
// keeping the data on screen while the next loads, preloading and the skeleton's motion. They ran
// on the monthly review's blocks until #126 took its made-up data away; they now run on the
// operations page, whose list loads on its own in the browser (`loadBlocks`), with its skeleton
// and its error. Dropped with the review's features (#126, back with v0.4): approving a line (the
// refused approval's rollback, a line already reviewed elsewhere) and the month switcher (its
// failed block, its preloaded months).
//
// Each user here is the file's own (`personOfItsOwn`), so that the lines are known whatever the
// worker's other specs add to the shared users: Lucien and Mireille each have one account and a
// few invented lines.

const TODAY = "2026-11-15";
const LATENCY_MS = 1500;
const SLOW_SEARCH_MS = 4000;

const BAKERY = "CB CORNER BAKERY";
const TRAM = "CB CITY TRAM PASS";
const BOOKSHOP = "CB NORTHWIND BOOKSHOP";
const GARDEN = "CB GREEN THUMB GARDEN SHOP";

let data: ReturnType<typeof openUserData>;
let lucien: TestUser;
let mireille: TestUser;

/** An account of `person`'s, and one line for each label, booked before today. */
async function withLines(person: TestUser, accountName: string, labels: ReadonlyArray<string>) {
  const owner = await data.ownerOf(person.email);

  await data.asUser(owner, async (each) => {
    const [created] = await each
      .insert(account)
      .values({ userId: owner, name: accountName, kind: "current", currency: "EUR" })
      .returning({ id: account.id });

    if (created === undefined) {
      throw new Error("The account was not created.");
    }

    await each.insert(statementLine).values(
      labels.map((label, index) => ({
        userId: owner,
        accountId: created.id,
        source: "manual" as const,
        bookedOn: `2026-11-${String(10 - index).padStart(2, "0")}`,
        amountMinor: -(450 + index * 1000),
        label,
      })),
    );
  });
}

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  lucien = await addUser(app.baseURL, user, personOfItsOwn("lucien"));
  mireille = await addUser(app.baseURL, user, personOfItsOwn("mireille"));
  await withLines(lucien, "Lucien current", [BAKERY, TRAM, BOOKSHOP]);
  await withLines(mireille, "Mireille current", [GARDEN]);
});

test.afterAll(async () => {
  await data.close();
});

/** The page, signed in as `person`, on the fixed day. */
async function signedInAs(page: Page, person: TestUser) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const list = (page: Page) => page.getByRole("list", { name: "Operations" });

const row = (page: Page, label: string) =>
  list(page).getByRole("listitem").filter({ hasText: label });

const count = (page: Page) => page.locator('[data-slot="operations-count"]');

/** The bordered block that holds the list, its skeleton or its error, whichever is shown. */
const listBlock = (page: Page) =>
  page.locator('[data-slot="operations-layout"] > div:last-child > div:first-child');

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search" });

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

/** Leaves for another screen, so that the way to the operations is a client navigation. */
async function openAccountsPage(page: Page) {
  await visit(page, "/accounts");
}

/** To the operations through the frame's link, the sidebar's or the tab bar's. */
async function toOperations(page: Page) {
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Operations" })
    .click();
}

/** Whether a server function call is the list's search: only its payload has a page size. */
const isSearch = (url: string) => decodeURIComponent(url).includes("limit");

test("the first visit shows no skeleton", async ({ page }) => {
  await signedInAs(page, lucien);

  const counts = await watchLoading(page);

  // The page as the server sent it, before any script ran: filled in.
  const rendered = await page.request.get("/operations");
  const html = await rendered.text();

  expect(rendered.ok()).toBe(true);
  expect(html).toContain(BAKERY);
  expect(html).not.toContain('aria-busy="true"');

  await visit(page, "/operations");

  await expect(row(page, BAKERY)).toBeVisible();
  await expect(count(page)).toHaveText("3 lines");
  await expect(page.locator(SKELETON)).toHaveCount(0);
  expect((await counts()).skeletons).toBe(0);
});

test("with latency on, each block shows its own skeleton and the page's layout does not shift when data arrives", async ({
  page,
}) => {
  await signedInAs(page, lucien);

  const counts = await watchLoading(page);

  await openAccountsPage(page);
  await slowServerFunctions(page, LATENCY_MS);
  await toOperations(page);

  // The list waits in its own block, as a skeleton; the filters are there at once.
  await expect(listBlock(page).getByRole("status", { name: "Loading" })).toBeVisible();
  await expect(searchBox(page)).toBeVisible();

  // Shown only after about 150 ms, then faded in.
  const skeleton = page.locator(SKELETON).first();

  await expect(skeleton).toHaveCSS("animation-delay", "0.15s");
  await expect(skeleton).toHaveCSS("animation-duration", "0.2s");

  const parts = [listBlock(page), count(page), searchBox(page)];
  const whileLoading = await Promise.all(parts.map((part) => part.boundingBox()));
  // From here on: the navigation itself (one page giving way to the other) is not what is measured.
  const before = await counts();

  await expect(row(page, BAKERY)).toBeVisible({ timeout: 10_000 });
  await expect(count(page)).toHaveText("3 lines");
  await expect(page.locator(SKELETON)).toHaveCount(0);

  const loaded = await Promise.all(parts.map((part) => part.boundingBox()));

  // The skeleton has its block's exact shape: nothing moved.
  expect(loaded).toEqual(whileLoading);

  const after = await counts();

  expect(after.skeletons).toBeGreaterThan(0);
  // Chromium measures it; Firefox has no layout-shift entries (`null` before and after).
  expect(after.layoutShift).toBe(before.layoutShift);
  await animationsDone(page);
});

test("under reduced motion a skeleton appears without its fade", async ({ page }) => {
  await signedInAs(page, lucien);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openAccountsPage(page);
  await slowServerFunctions(page, LATENCY_MS);
  await toOperations(page);

  const skeleton = page.locator(SKELETON).first();

  await expect(skeleton).toBeVisible();
  await expect(skeleton).toHaveCSS("animation-duration", "0s");
  await expect(page.locator(SKELETON)).toHaveCount(0, { timeout: 10_000 });
});

test("an error stays in its block, with a retry, and the rest of the page works", async ({
  page,
}) => {
  await signedInAs(page, lucien);
  await openAccountsPage(page);

  // Only the list's search fails, until the test lets it: the accounts still load.
  let failing = true;

  await page.route(SERVER_FUNCTIONS, async (route) => {
    if (failing && isSearch(route.request().url())) {
      await route.fulfill({ status: 500, body: "Failed by the test." });

      return;
    }

    await route.fallback();
  });

  await toOperations(page);

  const block = listBlock(page);

  await expect(block.getByRole("alert")).toContainText("This block could not be loaded", {
    timeout: 10_000,
  });

  // The rest of the page has its data, and its controls still work: the filters offer the
  // accounts.
  await page.getByRole("combobox", { name: "Account" }).click();
  await expect(page.getByRole("option", { name: "Lucien current", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);

  failing = false;
  await block.getByRole("button", { name: "Try again" }).click();

  await expect(row(page, BAKERY)).toBeVisible({ timeout: 10_000 });
  await expect(block.getByRole("alert")).toHaveCount(0);
  // Faded in: axe measures its contrast at the end of the test.
  await animationsDone(page);
});

test("a user who signs in after another in the same tab never sees the other's data", async ({
  page,
  baseURL,
}) => {
  // Lucien signs out below: in a session of his own, never the one the file's other tests use.
  const own = await signIn(baseURL ?? "", lucien);

  await signedInAs(page, own);
  await visit(page, "/operations");
  await expect(row(page, BAKERY)).toBeVisible();

  // He signs out, and Mireille signs in, in the same tab: no reload anywhere.
  await page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "yes";
  });
  const menu = await openAccountMenu(page, lucien.name);

  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel("E-mail").fill(mireille.email);
  await page.getByLabel("Password", { exact: true }).fill(mireille.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  await toOperations(page);

  // Her own lines, not the list Lucien's search left behind.
  await expect(row(page, GARDEN)).toBeVisible({ timeout: 10_000 });
  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, BAKERY)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.e2eNoReload)).toBe("yes");
  await animationsDone(page);
});

test("a new search keeps the current list on screen while it loads", async ({ page }) => {
  await signedInAs(page, lucien);

  const counts = await watchLoading(page);

  // The first paint is the server's; the browser's calls, the new search among them, are slowed:
  // the navigation asks who is looking, then the search, each long enough for the checks below to
  // come while the search is still on its way.
  await visit(page, "/operations");
  await hydrated(page);
  await slowServerFunctions(page, SLOW_SEARCH_MS);

  await searchBox(page).fill("bakery");

  // The search is on its way (the address has it); the last list stays on screen, without a
  // skeleton, and so does its count.
  await expect(page).toHaveURL(/[?&]q=bakery(&|$)/);
  await expect(row(page, TRAM)).toBeVisible();
  await expect(count(page)).toHaveText("3 lines");

  await expect(count(page)).toHaveText("1 line", { timeout: 2 * SLOW_SEARCH_MS + 10_000 });
  await expect(row(page, BAKERY)).toBeVisible();
  await expect(row(page, TRAM)).toHaveCount(0);
  expect((await counts()).skeletons).toBe(0);
  await animationsDone(page);
});

/** Records the server functions a page asks for from now on. */
function recordAsked(page: Page) {
  const asked: Array<string> = [];

  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) {
      asked.push(request.url());
    }
  });

  return asked;
}

/** Opens a screen without the operations' data, and records the server functions asked after. */
async function fromAccounts(page: Page) {
  await openAccountsPage(page);

  return recordAsked(page);
}

test("a link preloads its route on hover and on focus", async ({ page }) => {
  await signedInAs(page, lucien);

  const hovered = await fromAccounts(page);

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Operations" })
    .hover();
  await expect.poll(() => hovered.some(isSearch)).toBe(true);

  const other = await page.context().newPage();

  try {
    await fixDay(other, TODAY);

    const focused = await fromAccounts(other);

    await other
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Operations" })
      .focus();
    await expect.poll(() => focused.some(isSearch)).toBe(true);
  } finally {
    await other.close();
  }

  // Nothing was clicked: still on the accounts.
  await expect(page).toHaveURL(/\/accounts$/);
});
