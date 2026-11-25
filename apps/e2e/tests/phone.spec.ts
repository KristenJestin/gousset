import type { Page } from "@playwright/test";
import { Schema } from "effect";

import type { TestUser } from "../src/auth";
import { colorSchemeOf } from "../src/database";
import { onPhone } from "../src/frame";
import { block, monthBarKey, monthSwitcher, openBlock, seedReviewMonths } from "../src/review";
import { addUser, animationsDone, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// The scenarios of issue #36 (the review on a phone), "How to verify", with the wireframe
// `mobile`: the app installs on a phone's home screen, its bars take the page's colour, what runs
// along the screen's bottom edge keeps clear of the phone's own, the month sits across the top and
// the month bar's amounts are listed under it.
// The review's blocks folded on a phone are review.spec.ts's; the lines reviewed on a phone are
// review-lines.spec.ts's. Every name and amount is invented.

const TODAY = "2026-11-15";
const OCTOBER = "/?month=2026-10";

/** The page's background, `--background`, as the browser's own bars take it. */
const THEME = { light: "#f8f7f4", dark: "#110f0d" } as const;

/** The home indicator of a phone without a home button: the bottom inset an installed app gets. */
const HOME_INDICATOR = 34;

/** What the test reads of the web manifest. */
const Manifest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  short_name: Schema.String,
  start_url: Schema.String,
  scope: Schema.String,
  display: Schema.String,
  icons: Schema.Array(
    Schema.Struct({ src: Schema.String, sizes: Schema.String, purpose: Schema.String }),
  ),
});

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, signed in on `page` on the fixed day, with their two months. */
async function signedInWithMonths(page: Page, baseURL: string, admin: TestUser, local: string) {
  const person = await addUser(baseURL, admin, personOfItsOwn(local));

  await seedReviewMonths(data, await data.ownerOf(person.email));
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  return person;
}

/** The colour each `<meta name="theme-color">` gives, with the media it is for. */
const themeColors = (page: Page) =>
  page.locator('meta[name="theme-color"]').evaluateAll((metas) =>
    metas.map((meta) => ({
      media: meta.getAttribute("media"),
      content: meta.getAttribute("content"),
    })),
  );

test("the app installs on the home screen, and keeps nothing of the user's on the phone", async ({
  userPage,
  request,
}) => {
  await visit(userPage, "/");

  // What an installed app is: its own window, its name, its icons, from the start page.
  const manifest = await request.get("/manifest.webmanifest");

  expect(manifest.ok()).toBe(true);

  const read = Schema.decodeUnknownSync(Manifest)(await manifest.json());

  expect(read).toMatchObject({
    id: "/",
    name: "Gousset",
    short_name: "Gousset",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(read.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "432x432 maskable",
  ]);

  // The iOS home screen reads the page itself: its title and its own window.
  await expect(userPage.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Gousset",
  );
  await expect(userPage.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(userPage.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  // The page reaches the screen's edges; what runs along them keeps clear (the next tests).
  await expect(userPage.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );

  // The browser's bars take the page's background, in each scheme of the system.
  expect(await themeColors(userPage)).toEqual([
    { media: "(prefers-color-scheme: light)", content: THEME.light },
    { media: "(prefers-color-scheme: dark)", content: THEME.dark },
  ]);

  // No service worker and no cache: no amount, no label stays on the phone once the app is closed.
  expect(
    await userPage.evaluate(async () => {
      const workers =
        "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];

      return { workers: workers.length, caches: (await caches.keys()).length };
    }),
  ).toEqual({ workers: 0, caches: 0 });
});

test("the browser's bars follow the colour scheme the user picked, not the system's", async ({
  page,
  app,
  user,
}) => {
  const person = await addUser(app.baseURL, user, personOfItsOwn("solene"));

  await page.context().addCookies([...person.cookies]);
  await page.emulateMedia({ colorScheme: "light" });
  await visit(page, "/settings");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect.poll(() => colorSchemeOf(app.database, person.email)).toBe("dark");

  // Every theme colour is the dark one, whatever scheme the system is in.
  await expect
    .poll(async () => (await themeColors(page)).map((meta) => meta.content))
    .toEqual([THEME.dark, THEME.dark]);

  // And again from the server, on the next visit.
  await page.reload();
  await expect
    .poll(async () => (await themeColors(page)).map((meta) => meta.content))
    .toEqual([THEME.dark, THEME.dark]);

  // Back to the system's: each scheme its own again.
  await page.getByRole("radio", { name: "System" }).click();
  await expect
    .poll(async () => (await themeColors(page)).map((meta) => meta.content))
    .toEqual([THEME.light, THEME.dark]);
});

test("on a phone, the tab bar and the sheets keep clear of the home indicator", async ({
  page,
  app,
  user,
  browserName,
}) => {
  test.skip(!onPhone(page), "The tab bar and the bottom sheets are a phone's");
  test.skip(browserName !== "chromium", "Chromium alone emulates a phone's safe area");

  await signedInWithMonths(page, app.baseURL, user, "lazare");

  // An installed app on a phone without a home button: its bottom 34 px are the system's.
  const cdp = await page.context().newCDPSession(page);

  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { bottom: HOME_INDICATOR, bottomMax: HOME_INDICATOR },
  });
  await visit(page, OCTOBER);

  // The tab bar reaches the bottom edge, its tabs above the indicator, 64 px tall as without it.
  const tabBar = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  const viewport = page.viewportSize()?.height ?? 0;
  const bar = await tabBar.boundingBox();

  expect(bar?.y === undefined ? null : Math.round(bar.y + bar.height)).toBe(viewport);
  await expect(tabBar).toHaveCSS("padding-bottom", `${String(HOME_INDICATOR)}px`);
  expect(
    Math.round((await tabBar.getByRole("link", { name: "Review" }).boundingBox())?.height ?? 0),
  ).toBe(64);

  // The page's end scrolls clear of the tab bar and of the indicator.
  await expect(page.locator('[data-slot="screen"]').locator("..")).toHaveCSS(
    "padding-bottom",
    `${String(64 + HOME_INDICATOR)}px`,
  );

  // A sheet along the bottom edge keeps its content above the indicator, its surface under it.
  const movements = await openBlock(page, "Movements");

  await expect(movements).toHaveCSS("padding-bottom", `${String(HOME_INDICATOR)}px`);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await animationsDone(page);
});

test("on a phone, the month bar lists spent, set aside and left under it, one row each", async ({
  page,
  app,
  user,
}) => {
  test.skip(!onPhone(page), "On a wide screen the keys sit side by side");

  await signedInWithMonths(page, app.baseURL, user, "oriane");
  await visit(page, OCTOBER);
  await expect(monthBarKey(page, "left")).toContainText("€1,345");

  const bar = await block(page, "The month")
    .locator('[data-slot="month-bar-drawing"]')
    .boundingBox();

  const rows = await Promise.all(
    (["spent", "saved", "left"] as const).map(async (role) =>
      monthBarKey(page, role).boundingBox(),
    ),
  );

  let above = (bar?.y ?? 0) + (bar?.height ?? 0);

  for (const row of rows) {
    // Under the bar and under the row before, as wide as the bar, give or take its hover band.
    expect(row?.y ?? 0).toBeGreaterThanOrEqual(above);
    expect(Math.abs((row?.width ?? 0) - (bar?.width ?? 0))).toBeLessThanOrEqual(8);
    above = (row?.y ?? 0) + (row?.height ?? 0);
  }

  await expect(monthBarKey(page, "saved")).toContainText("set aside");
  await animationsDone(page);
});

test("on a phone, the month sits across the top, its arrows at the screen's edges", async ({
  page,
  app,
  user,
}) => {
  test.skip(!onPhone(page), "On a wide screen the month sits beside the title");

  await signedInWithMonths(page, app.baseURL, user, "maxence");
  await visit(page, OCTOBER);

  await expect(monthSwitcher(page)).toContainText("October 2026");

  const [main, previous, next, title] = await Promise.all([
    page.getByRole("main").boundingBox(),
    monthSwitcher(page).getByRole("button", { name: "Previous month" }).boundingBox(),
    monthSwitcher(page).getByRole("button", { name: "Next month" }).boundingBox(),
    page.getByRole("heading", { level: 1, name: "Monthly review" }).boundingBox(),
  ]);

  if (main === null || previous === null || next === null || title === null) {
    throw new Error("The review's header is not on screen.");
  }

  // The page's 16 px of padding on each side, the arrows at its edges.
  expect(Math.round(previous.x - main.x)).toBe(16);
  expect(Math.round(main.x + main.width - (next.x + next.width))).toBe(16);
  // Under the title, on a line of its own.
  expect(previous.y).toBeGreaterThanOrEqual(title.y + title.height);
  await animationsDone(page);
});
