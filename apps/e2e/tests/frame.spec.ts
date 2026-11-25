import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { APP_HOST } from "../src/app-server";
import { colorSchemeOf } from "../src/database";
import { onPhone, openAccountMenu, textSight } from "../src/frame";
import {
  addUser,
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";

// The scenarios of issue #8 (the app's frame and navigation), "How to verify", one test each,
// plus the issue's motion and its other points: the month in the URL, the language, the brand.

/** Paraglide's cookie: the language the user chose (packages/i18n, strategy `cookie`). */
const LANGUAGE_COOKIE = "PARAGLIDE_LOCALE";

/** Every screen of the frame, with its title in English and in French. */
const SCREENS = [
  { path: "/", name: "review", en: "Monthly review", fr: "Bilan du mois" },
  { path: "/operations", name: "operations", en: "Operations", fr: "Opérations" },
  { path: "/accounts", name: "accounts", en: "Accounts", fr: "Comptes" },
  { path: "/investments", name: "investments", en: "Investments", fr: "Placements" },
  { path: "/subjects", name: "subjects", en: "Subjects", fr: "Sujets" },
  { path: "/import", name: "import", en: "Import", fr: "Import" },
  { path: "/settings", name: "settings", en: "Settings", fr: "Réglages" },
  { path: "/settings/account", name: "account", en: "Settings", fr: "Réglages" },
  { path: "/settings/categories", name: "categories", en: "Settings", fr: "Réglages" },
  { path: "/settings/rules", name: "rules", en: "Settings", fr: "Réglages" },
  { path: "/settings/data", name: "data", en: "Settings", fr: "Réglages" },
  { path: "/settings/users", name: "users", en: "Settings", fr: "Réglages" },
] as const;

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** What the test reads of the web manifest. */
const Manifest = Schema.Struct({
  icons: Schema.Array(Schema.Struct({ sizes: Schema.String, purpose: Schema.String })),
});

/** The language the user chose, kept in Paraglide's cookie; none while they chose nothing. */
async function languageCookie(page: Page) {
  const cookies = await page.context().cookies();

  return cookies.find((cookie) => cookie.name === LANGUAGE_COOKIE)?.value;
}

/** One frame of a move between screens: when, from the press, and what the frame showed. */
type MoveFrame = { at: number; opacity: number; markTop: number };

/**
 * Clicks the sidebar's link named `name` and, from the press, samples at every frame for 700 ms
 * the screen's opacity and where the sidebar's current-item mark stands. Nothing depends on how
 * fast frames come.
 */
async function moveTo(page: Page, name: string) {
  const frames = page.evaluate(
    (duration) =>
      new Promise<Array<MoveFrame>>((resolve) => {
        const seen: Array<MoveFrame> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const screen = document.querySelector('[data-slot="screen"]');
              const mark = document.querySelector('aside [data-slot="current-mark"]');

              seen.push({
                at: performance.now() - start,
                opacity: screen === null ? 1 : Number(getComputedStyle(screen).opacity),
                markTop: mark === null ? Number.NaN : mark.getBoundingClientRect().top,
              });

              if (performance.now() - start < duration) {
                requestAnimationFrame(sample);
              } else {
                resolve(seen);
              }
            };

            requestAnimationFrame(sample);
          },
          { once: true, capture: true },
        );
      }),
    700,
  );

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();

  return frames;
}

/** The frames where the screen was neither hidden nor fully drawn: its fade. */
function fading(frames: Array<MoveFrame>) {
  return frames.filter((frame) => frame.opacity > 0.01 && frame.opacity < 0.99);
}

/** The frames where the mark stood between the item it left and the item it reached: its slide. */
function sliding(frames: Array<MoveFrame>) {
  const from = frames.at(0)?.markTop ?? Number.NaN;
  const to = frames.at(-1)?.markTop ?? Number.NaN;
  const low = Math.min(from, to) + 0.5;
  const high = Math.max(from, to) - 0.5;

  return frames.filter((frame) => frame.markTop > low && frame.markTop < high);
}

/** How long, in ms, from the first of these frames to the last. */
function spanOf(frames: Array<MoveFrame>) {
  return (frames.at(-1)?.at ?? 0) - (frames.at(0)?.at ?? 0);
}

async function chooseLanguage(page: Page, language: "en" | "fr") {
  await page
    .context()
    .addCookies([{ name: LANGUAGE_COOKIE, value: language, domain: APP_HOST, path: "/" }]);
}

test("every route renders signed in at 1440 px and at 390 px, light and dark, in English and in French", async ({
  userPage,
}, testInfo) => {
  test.setTimeout(240_000);
  await fixDay(userPage, "2026-11-15");

  for (const language of ["en", "fr"] as const) {
    await chooseLanguage(userPage, language);

    for (const size of WIDTHS) {
      await userPage.setViewportSize({ width: size.width, height: size.height });

      for (const screen of SCREENS) {
        await userPage.goto(screen.path);
        await expect(userPage.locator("html")).toHaveAttribute("lang", language);

        for (const scheme of ["light", "dark"] as const) {
          await userPage.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

          await expect(
            userPage.getByRole("heading", { level: 1, name: screen[language] }),
          ).toBeVisible();

          // Kept as CI artifacts (`screens`), the pull request's pictures.
          await userPage.screenshot({
            path: testInfo.outputPath(
              "screens",
              `${screen.name}-${size.name}-${scheme}-${language}.png`,
            ),
            fullPage: true,
          });
        }
      }

      // Once per language and width: the frame holds no violation.
      await expectAccessible(userPage);
    }
  }
});

// "A test fails when a component holds text outside the messages": it is the lint that refuses
// it, so the scenario runs `vp lint` on probes, in packages/ui/e2e/lint.e2e.ts (`lint` project).

test("the sidebar names every screen, the current one marked", async ({ userPage }) => {
  test.skip(onPhone(userPage), "The sidebar is the desktop's; the tab bar has its own test.");
  await visit(userPage, "/accounts");

  const navigation = userPage.getByRole("navigation", { name: "Main" });

  await expect(navigation.getByRole("link")).toHaveText([
    "Review",
    "Operations",
    "Accounts",
    "Investments",
    "Subjects",
    "Import",
  ]);
  await expect(userPage.getByRole("link", { name: "Accounts" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await userPage.getByRole("link", { name: "Settings" }).click();
  await expect(userPage).toHaveURL(/\/settings$/);
  await expect(userPage.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await userPage.getByRole("link", { name: "Rules" }).click();
  await expect(userPage).toHaveURL(/\/settings\/rules$/);
  // The rules screen, with or without rules: the worker's user has one once a test seeded it.
  await expect(userPage.getByRole("button", { name: "Add a rule" })).toBeVisible();
  // The screen reached fades in: axe checks it once drawn.
  await animationsDone(userPage);
});

// Issue #81: the current item's mark was painted over its label in the wide sidebar.
test("the current item's label is visible", async ({ userPage }) => {
  await visit(userPage, "/operations");

  // The sidebar's on a desktop, the tab bar's on a phone: the one navigation shown.
  const current = userPage
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Operations" });

  const label = current.getByText("Operations", { exact: true });

  await expect(current).toHaveAttribute("aria-current", "page");

  for (const scheme of ["light", "dark"] as const) {
    await userPage.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

    // The user keeps the system's scheme: the page follows it.
    if (scheme === "dark") {
      await expect(userPage.locator("html")).toHaveClass(/\bdark\b/);
    } else {
      await expect(userPage.locator("html")).not.toHaveClass(/\bdark\b/);
    }

    await expect(label).toBeVisible();

    const sight = await textSight(label);

    expect(sight.onTop, `${scheme}: nothing is painted over the label`).toBe(true);
    // WCAG AA for text of its size.
    expect(sight.contrast, `${scheme}: the label's contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("on a phone, a tab bar holds review, operations, accounts and more", async ({
  userPage,
  user,
}) => {
  await userPage.setViewportSize({ width: 390, height: 844 });
  await visit(userPage, "/");

  const tabs = userPage.getByRole("navigation", { name: "Main" });

  await expect(tabs.getByRole("link")).toHaveText(["Review", "Operations", "Accounts"]);
  await expect(tabs.getByRole("button", { name: "More" })).toBeVisible();

  const menu = await openAccountMenu(userPage, user.name);

  // The other screens, then the account as the user's menu holds it (#105).
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Investments",
    "Subjects",
    "Import",
    "Settings",
    "Keyboard shortcuts",
    "Sign out",
  ]);
  await expect(menu.getByRole("group")).toContainText(user.email);

  await menu.getByRole("menuitem", { name: "Subjects" }).click();
  await expect(userPage).toHaveURL(/\/subjects$/);
  await expect(userPage.getByRole("heading", { level: 1, name: "Subjects" })).toBeVisible();
  // The menu fades out and the screen in: axe checks the screen once they are drawn.
  await animationsDone(userPage);
});

test("an older month address still opens its screen", async ({ userPage }) => {
  await fixDay(userPage, "2026-11-15");

  // The review opens on the address's month (#32), or leads a user with no line yet to the first
  // import (the worker's user may have imported in another test); its link is the current one.
  await visit(userPage, "/?month=2026-10");
  await expect(userPage.getByRole("main")).toContainText(
    /October 2026|Your review starts with your first import/,
  );
  await expect(
    userPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Review" }),
  ).toHaveAttribute("aria-current", "page");

  // The operations read the older address's month as its first to last day.
  await visit(userPage, "/operations?month=2025-02");

  // On a phone the period is in the Filters sheet (#127).
  const filters = userPage.getByRole("button", { name: "Filters", exact: true });

  if (await filters.isVisible()) {
    await expect(filters).toHaveAttribute("data-hydrated", "");
    await filters.click();
  }

  await expect(userPage.getByRole("textbox", { name: "From", exact: true })).toHaveValue(
    "02/01/2025",
  );
  await expect(userPage.getByRole("textbox", { name: "To", exact: true })).toHaveValue(
    "02/28/2025",
  );
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the language follows the browser, and the user changes it", async ({
    userPage,
    browser,
    baseURL,
    viewport,
  }) => {
    await fixDay(userPage, "2026-11-15");
    await visit(userPage, "/");

    await expect(userPage.locator("html")).toHaveAttribute("lang", "fr");
    await expect(userPage.getByRole("heading", { level: 1, name: "Bilan du mois" })).toBeVisible();
    // The screen's own words too, not only the frame's: its month by locale, or its empty state.
    await expect(userPage.getByRole("main")).toContainText(
      /novembre 2026|Votre bilan commence avec votre premier import/i,
    );
    // Following the browser saves nothing: the browser's next language still wins.
    expect(await languageCookie(userPage)).toBeUndefined();

    // The same browser, its cookies kept, now set to English: the next visit is in English.
    const english = await browser.newContext({
      baseURL,
      viewport,
      locale: "en-US",
      storageState: await userPage.context().storageState(),
    });

    try {
      const page = await english.newPage();

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
    } finally {
      await english.close();
    }

    await visit(userPage, "/settings");
    await userPage.getByRole("radio", { name: "English" }).click();

    // Kept on this browser: the next visit is in English, whatever the browser says.
    await expect(userPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    expect(await languageCookie(userPage)).toBe("en");
    await userPage.goto("/");
    await expect(userPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(userPage.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  });
});

// Issue #105: the user's menu holds only what the settings do not.
test("the user's menu holds only its four items: who is signed in, settings, shortcuts, sign out", async ({
  userPage,
  user,
}) => {
  test.skip(onPhone(userPage), "The phone's More holds the screens too; its own test checks it.");
  await visit(userPage, "/");

  const menu = await openAccountMenu(userPage, user.name);
  const account = menu.getByRole("group");

  // Their name and e-mail at its top, naming the account's actions.
  await expect(account).toHaveAccessibleName(new RegExp(user.name));
  await expect(account).toContainText(user.email);
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Settings",
    "Keyboard shortcuts",
    "Sign out",
  ]);
  await expect(menu.getByRole("menuitemradio")).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Settings" }).click();
  await expect(userPage).toHaveURL(/\/settings$/);
  await expect(userPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  // The menu fades out and the screen in: axe checks the screen once they are drawn.
  await animationsDone(userPage);
});

test("the language and the colour scheme are changed from the settings", async ({
  page,
  app,
  user,
}) => {
  // The scheme is kept on the account: a user of the test's own, so that the worker's shared one
  // keeps the system's.
  const ezra = await addUser(app.baseURL, user, personOfItsOwn("ezra"));

  await page.context().addCookies([...ezra.cookies]);
  await visit(page, "/settings");

  // Applied at once, without a reload, and kept on the account.
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect.poll(() => colorSchemeOf(app.database, ezra.email)).toBe("dark");

  // Nothing chosen yet: the language follows the browser, and no cookie keeps one.
  await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
  expect(await languageCookie(page)).toBeUndefined();
  await page.getByRole("radio", { name: "Français" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  expect(await languageCookie(page)).toBe("fr");
  // The new language reloads the page; the server paints it in the scheme just picked, which
  // reached the account first.
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  // The screen reached fades in: axe checks it once drawn.
  await animationsDone(page);
});

test("moving between screens fades the screen, the current item slides, empty states fade in", async ({
  userPage,
}) => {
  test.skip(onPhone(userPage), "The sidebar is the desktop's.");
  await visit(userPage, "/investments");

  // The empty state fades in through CSS, 200 ms.
  const block = userPage.locator('[data-slot="screen-block"]');

  await expect(block).toHaveCSS("animation-duration", "0.2s");
  await expect(block).toHaveCSS("animation-name", "enter");

  // The screen reached fades in, and the current item's mark slides from the item left to it:
  // 200 ms each, so a few frames in between, all within 400 ms of each other.
  const moved = await moveTo(userPage, "Subjects");

  await expect(userPage.getByRole("link", { name: "Subjects" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(fading(moved).length).toBeGreaterThan(1);
  expect(spanOf(fading(moved))).toBeLessThan(400);
  expect(sliding(moved).length).toBeGreaterThan(1);
  expect(spanOf(sliding(moved))).toBeLessThan(400);

  // Cut under reduced motion: the screen shows at once, the mark is at once on its item.
  await userPage.emulateMedia({ reducedMotion: "reduce" });

  const cut = await moveTo(userPage, "Investments");

  await expect(userPage.getByRole("link", { name: "Investments" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(fading(cut)).toEqual([]);
  expect(sliding(cut)).toEqual([]);
  await expect(block).toHaveCSS("animation-duration", "0s");
});

test("the brand: favicons, the iOS icon and a web manifest with its icons", async ({
  userPage,
  request,
}) => {
  await visit(userPage, "/");

  await expect(userPage.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  await expect(userPage.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(userPage.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );

  // The mark tops the sidebar; a phone has neither (the `mobile` wireframe).
  if (!onPhone(userPage)) {
    await expect(userPage.getByRole("img", { name: "Gousset" }).first()).toBeVisible();
  }

  const manifest = await request.get("/manifest.webmanifest");

  expect(manifest.ok()).toBe(true);

  const { icons } = Schema.decodeUnknownSync(Manifest)(await manifest.json());

  expect(icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual([
    "192x192 any",
    "512x512 any",
    "432x432 maskable",
  ]);

  for (const path of [
    "/favicon.ico",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-432.png",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});
