import { expect, test } from "@playwright/test";

/**
 * The general and account sections of the settings (issue #105), as the app composes them, and the
 * dialog that changes the password: reference screenshots on a desktop and on a phone, light and
 * dark. Firefox draws the same components in its own checks. Reduced motion: caught in their final
 * state.
 *
 * The references come from CI (`.github/workflows/ui-snapshots.yml`), never from a local browser.
 */
const story = (name: string) => `/iframe.html?id=layout-app-shell--${name}&viewMode=story`;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme}`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "firefox", "A desktop and a phone, both in Chromium");
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    });

    test(`the general section of the settings, ${scheme}`, async ({ page }) => {
      await page.goto(story("general-section"));
      await expect(
        page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "General" }),
      ).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
      await expect(page.getByRole("radio", { name: "System" })).toBeChecked();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await expect(page).toHaveScreenshot(`settings-general-${scheme}.png`, { fullPage: true });
    });

    test(`the account section of the settings and its password dialog, ${scheme}`, async ({
      page,
    }) => {
      await page.goto(story("account-section"));
      await expect(
        page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Account" }),
      ).toHaveAttribute("aria-current", "page");
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await expect(page).toHaveScreenshot(`settings-account-${scheme}.png`, { fullPage: true });

      await page.getByRole("button", { name: "Change password" }).click();

      const dialog = page.getByRole("dialog", { name: "Change your password" });

      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("New password", { exact: true })).toHaveAccessibleDescription(
        "8 to 128 characters.",
      );

      await expect(page).toHaveScreenshot(`settings-account-dialog-${scheme}.png`);
    });
  });
}
