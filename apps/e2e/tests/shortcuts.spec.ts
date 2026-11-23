import type { Page } from "@playwright/test";

import { openAccountMenu } from "../src/frame";
import { animationsDone, expect, test, visit } from "../src/test";

/** The page, once its scripts are loaded and the shortcuts listen. */
async function openHome(page: Page) {
  await visit(page, "/");
  await page.waitForLoadState("networkidle");
}

test("? opens the list of shortcuts, built from their declarations", async ({ page }) => {
  await openHome(page);

  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("term")).toHaveText([
    "Show keyboard shortcuts",
    "Show keyboard shortcuts",
    "Search",
  ]);
  await expect(dialog.getByRole("definition")).toHaveText(["?", /\/$/, /K$/]);

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
});

test("Mod+/ opens the list of shortcuts too", async ({ page }) => {
  await openHome(page);

  await page.keyboard.press("ControlOrMeta+/");

  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  // The dialog still fading in would fail axe's contrast check at the end.
  await animationsDone(page);
});

test("Mod+K opens the search, empty for now", async ({ page }) => {
  await openHome(page);

  await page.keyboard.press("ControlOrMeta+k");

  const dialog = page.getByRole("dialog", { name: "Search" });

  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Nothing to search yet.");

  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(dialog).toBeHidden();
});

test("one shortcut's dialog gives way to the other's", async ({ page }) => {
  await openHome(page);

  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const search = page.getByRole("dialog", { name: "Search" });

  await page.keyboard.press("?");
  await expect(shortcuts).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(search).toBeVisible();
  await expect(shortcuts).toBeHidden();

  await page.keyboard.press("?");
  await expect(shortcuts).toBeVisible();
  await expect(search).toBeHidden();

  // Still open once every close event has been handled.
  await page.waitForTimeout(300);
  await expect(shortcuts).toBeVisible();
});

test("the list of shortcuts opens again right after Escape closed it", async ({ page }) => {
  await openHome(page);

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  // A close event that arrives after the dialog opened again must not close it.
  for (let round = 0; round < 3; round++) {
    await page.keyboard.press("?");
    await expect(dialog, `opening ${round + 1}`).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the list of shortcuts is in French", async ({ page }) => {
    await openHome(page);

    await page.keyboard.press("?");

    const dialog = page.getByRole("dialog", { name: "Raccourcis clavier" });

    await expect(dialog.getByRole("term")).toHaveText([
      "Afficher les raccourcis clavier",
      "Afficher les raccourcis clavier",
      "Rechercher",
    ]);
  });
});

// Issue #54 (WCAG 2.2, 2.1.4 Character Key Shortcuts): the shortcuts made of one character can be
// turned off, kept on the user; the list then opens from the user's menu and with Mod+/.

/**
 * Turns the user's single-key shortcuts on or off in the settings, and proves it was kept on the
 * account: a reload reads it back from the server.
 */
async function setSingleKeyShortcuts(page: Page, on: boolean) {
  await visit(page, "/settings");

  const setting = page.getByRole("switch", { name: "Single-key shortcuts" });

  if ((await setting.isChecked()) !== on) {
    // The save has answered before the reload, which would otherwise cut it short.
    const saved = page.waitForResponse((response) => response.request().method() === "POST");

    await setting.click();
    await saved;
  }

  await expect(setting).toBeChecked({ checked: on });
  await page.reload();
  await expect(setting).toBeChecked({ checked: on });
}

test("with the setting off, typing ? outside a text field opens nothing; the list opens from the menu", async ({
  userPage,
  user,
}) => {
  const dialog = userPage.getByRole("dialog", { name: "Keyboard shortcuts" });

  // On by default.
  await visit(userPage, "/settings");
  await expect(userPage.getByRole("switch", { name: "Single-key shortcuts" })).toBeChecked();

  await setSingleKeyShortcuts(userPage, false);
  await openHome(userPage);

  await userPage.keyboard.press("?");
  // Still closed once every key handler has run.
  await userPage.waitForTimeout(300);
  await expect(dialog).toBeHidden();

  const menu = await openAccountMenu(userPage, user.name);

  await menu.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();

  await expect(dialog).toBeVisible();
  // The list holds only what still works: no single-key shortcut.
  await expect(dialog.getByRole("term")).toHaveText(["Show keyboard shortcuts", "Search"]);
  await expect(dialog.getByRole("definition")).toHaveText([/\/$/, /K$/]);

  await userPage.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // A shortcut with a modifier still opens it.
  await userPage.keyboard.press("ControlOrMeta+/");
  await expect(dialog).toBeVisible();
  await userPage.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Turned on again, `?` works again: the worker's later tests share this user.
  await setSingleKeyShortcuts(userPage, true);
  await openHome(userPage);
  await userPage.keyboard.press("?");
  await expect(dialog).toBeVisible();
});

test("the setting is the user's own: another user keeps single-key shortcuts on", async ({
  userPage,
  secondUserPage,
}) => {
  await setSingleKeyShortcuts(userPage, false);

  try {
    await openHome(secondUserPage);
    await secondUserPage.keyboard.press("?");
    await expect(secondUserPage.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  } finally {
    await setSingleKeyShortcuts(userPage, true);
  }
});

// The shared `Dialog` of packages/ui (#7): it fades and grows in 200 ms; reduced motion cuts every
// transition to 0 s.
test("the dialog fades in over 200 ms, and not at all under reduced motion", async ({ page }) => {
  await openHome(page);

  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  await expect(dialog).toHaveCSS("transition-duration", "0.2s");
  await expect(dialog).toHaveCSS("transition-property", /opacity/);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("?");

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0s");
});
