import { expect, test } from "@playwright/test";

/**
 * The users' section of the settings (issues #82 and #103), as the app composes it: reference
 * screenshots of the page, and of its "Create a user" dialog (a sheet on a phone), on a desktop and
 * on a phone, light and dark. Firefox draws the same components in its own checks; a third set of
 * this page would only add images. Reduced motion: caught in its final state.
 *
 * The references come from CI (the `references` job of `.github/workflows/ci.yml`), never from a
 * local browser.
 */
const STORY = "/iframe.html?id=layout-app-shell--users-section&viewMode=story";

for (const scheme of ["light", "dark"] as const) {
  test(`the users section of the settings, ${scheme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", "A desktop and a phone, both in Chromium");

    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(STORY);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Users" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Create a user" })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    await expect(page).toHaveScreenshot(`settings-users-${scheme}.png`, { fullPage: true });
  });

  test(`the users section's "Create a user" dialog, ${scheme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", "A desktop and a phone, both in Chromium");

    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(STORY);
    await page.getByRole("button", { name: "Create a user" }).click();

    const dialog = page.getByRole("dialog", { name: "Create a user" });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create the user" })).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    await expect(page).toHaveScreenshot(`settings-users-dialog-${scheme}.png`);
  });
}
