import type { Page } from "@playwright/test";

import { expect, test, visit } from "../src/test";

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
  await expect(dialog.getByRole("term")).toHaveText(["Show keyboard shortcuts", "Search"]);
  await expect(dialog.getByRole("definition")).toHaveText(["?", /K$/]);

  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
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
      "Rechercher",
    ]);
  });
});

test("the dialog fades in over 150 ms, and not at all under reduced motion", async ({ page }) => {
  await openHome(page);

  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  await expect(dialog).toHaveCSS("transition-duration", "0.15s");
  await expect(dialog).toHaveCSS("transition-property", /opacity/);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("?");

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-property", "none");
});
