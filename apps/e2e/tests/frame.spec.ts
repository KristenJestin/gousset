import type { Page } from "@playwright/test";
import { Schema } from "effect";

import { APP_HOST } from "../src/app-server";
import { onPhone, openAccountMenu } from "../src/frame";
import { expect, expectAccessible, fixDay, test, visit } from "../src/test";

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
  { path: "/settings/categories", name: "categories", en: "Settings", fr: "Réglages" },
  { path: "/settings/rules", name: "rules", en: "Settings", fr: "Réglages" },
] as const;

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

/** What the test reads of the web manifest. */
const Manifest = Schema.Struct({
  icons: Schema.Array(Schema.Struct({ sizes: Schema.String, purpose: Schema.String })),
});

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

// "A test fails when a component holds text outside the messages": a unit test, since it is the
// lint that refuses it (tools/lint/gousset/no-text-outside-messages.test.ts, run by `vp test`).

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
  await expect(userPage.getByText("No rule yet")).toBeVisible();
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

  await expect(menu.getByRole("menuitem")).toHaveText([
    "Investments",
    "Subjects",
    "Import",
    "Settings",
    "Change password",
    "Users",
    "Sign out",
  ]);

  await menu.getByRole("menuitem", { name: "Subjects" }).click();
  await expect(userPage).toHaveURL(/\/subjects$/);
  await expect(userPage.getByRole("heading", { level: 1, name: "Subjects" })).toBeVisible();
});

test("the month is kept in the url and moves with the switcher", async ({ userPage }) => {
  await fixDay(userPage, "2026-11-15");
  await visit(userPage, "/");

  const month = userPage.getByRole("group", { name: "Month" });

  // No month in the address: the current one, and nothing after it.
  await expect(month).toContainText("November 2026");
  await expect(month.getByRole("button", { name: "Next month" })).toBeDisabled();

  await month.getByRole("button", { name: "Previous month" }).click();
  await expect(userPage).toHaveURL(/\?month=2026-10$/);
  await expect(month).toContainText("October 2026");

  // The address alone opens the month, the operations' too.
  await userPage.reload();
  await expect(userPage.getByRole("group", { name: "Month" })).toContainText("October 2026");

  await visit(userPage, "/operations?month=2025-02");
  await expect(userPage.getByRole("group", { name: "Month" })).toContainText("February 2025");

  // A month that cannot be read is the current one, not an error.
  await visit(userPage, "/?month=2026-13");
  await expect(userPage.getByRole("group", { name: "Month" })).toContainText("November 2026");
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the language follows the browser, and the user changes it", async ({ userPage }) => {
    await fixDay(userPage, "2026-11-15");
    await visit(userPage, "/");

    await expect(userPage.locator("html")).toHaveAttribute("lang", "fr");
    await expect(userPage.getByRole("heading", { level: 1, name: "Bilan du mois" })).toBeVisible();
    // Dates by the user's locale.
    await expect(userPage.getByRole("group", { name: "Mois" })).toContainText(/novembre 2026/i);

    await visit(userPage, "/settings");
    await userPage.getByRole("radio", { name: "English" }).click();

    // Kept on this browser: the next visit is in English, whatever the browser says.
    await expect(userPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await userPage.goto("/");
    await expect(userPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(userPage.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  });
});

test("the user's menu changes the language and the colour scheme", async ({ userPage, user }) => {
  test.skip(onPhone(userPage), "On a phone, the language and the scheme are in Settings.");
  await visit(userPage, "/");

  let menu = await openAccountMenu(userPage, user.name);

  await menu.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(userPage.locator("html")).toHaveAttribute("data-color-scheme", "dark");

  menu = await openAccountMenu(userPage, user.name);
  await expect(menu.getByRole("menuitemradio", { name: "English" })).toBeChecked();
  await menu.getByRole("menuitemradio", { name: "Français" }).click();

  await expect(userPage.getByRole("heading", { level: 1, name: "Bilan du mois" })).toBeVisible();
  await expect(userPage.locator("html")).toHaveAttribute("lang", "fr");
});

test("moving between screens fades the screen, the current item slides, empty states fade in", async ({
  userPage,
}) => {
  test.skip(onPhone(userPage), "The sidebar is the desktop's.");
  await visit(userPage, "/accounts");

  // The empty state fades in through CSS, 200 ms.
  const block = userPage.locator('[data-slot="screen-block"]');

  await expect(block).toHaveCSS("animation-duration", "0.2s");
  await expect(block).toHaveCSS("animation-name", "enter");

  // The current item's background is one element, which moves to the item reached.
  const current = userPage
    .getByRole("navigation", { name: "Main" })
    .locator("[aria-current=page] > span")
    .first();

  await expect(current).toBeVisible();
  await userPage.getByRole("link", { name: "Subjects" }).click();
  await expect(userPage.getByRole("link", { name: "Subjects" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // The screen reached fades in and ends fully drawn.
  await expect(userPage.locator('[data-slot="screen"]')).toHaveCSS("opacity", "1");

  await userPage.emulateMedia({ reducedMotion: "reduce" });
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
  await expect(userPage.getByRole("img", { name: "Gousset" }).first()).toBeAttached();

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
