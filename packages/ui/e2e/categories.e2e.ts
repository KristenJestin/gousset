import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=categories-${component}--${name}&viewMode=story`;

async function heightOf(page: Page, url: string, selector: string) {
  await page.goto(url);

  const box = await page.locator(selector).first().boundingBox();

  expect(box).not.toBeNull();

  return box?.height ?? 0;
}

test.describe("CategoryTree", () => {
  test("lists two levels, children indented, with each row's figures and menu", async ({
    page,
  }) => {
    await page.goto(story("categorytree", "default"));

    const rows = page.locator('[data-slot="category-row"]');

    await expect(rows).toHaveCount(7);
    await expect(page.locator('[data-slot="category-row"][data-child]')).toHaveCount(3);
    await expect(rows.filter({ hasText: "Rent" })).toHaveAttribute("data-child", "");
    await expect(rows.filter({ hasText: "Housing" })).toContainText("automatic · €690");
    await expect(rows.filter({ hasText: "Housing" })).toContainText("24");
    // Two currencies, never converted.
    await expect(rows.filter({ hasText: "Leisure" })).toContainText("€160");
    await expect(rows.filter({ hasText: "Leisure" })).toContainText("$40");
    // No line in six months: a dash, not a zero in some currency.
    await expect(rows.filter({ hasText: "Other" })).toContainText("—");

    await page.getByRole("button", { name: "Actions on Groceries" }).click();
    await expect(page.getByRole("menuitem", { name: "Merge with…" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  });

  test("says the page's words when there is no row", async ({ page }) => {
    await page.goto(story("categorytree", "empty"));
    await expect(page.getByText("No archived category.")).toBeVisible();
    await expect(page.locator('[data-slot="category-row"]')).toHaveCount(0);
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("categorytree", "french"));
    await expect(page.getByText("Moyenne mensuelle")).toBeVisible();
    await expect(page.getByRole("button", { name: "Actions sur Groceries" })).toBeVisible();
  });

  test("its skeleton has the loaded tree's height", async ({ page }) => {
    const loaded = await heightOf(
      page,
      story("categorytree", "default"),
      '[data-slot="category-tree"]',
    );

    const loading = await heightOf(
      page,
      story("categorytree", "loading"),
      '[data-slot="skeleton-frame"]',
    );

    expect(loading).toBe(loaded);
  });

  test("its rows fade in on first paint in 200 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("categorytree", "default"));

    const row = page.locator('[data-slot="category-row"]').first();

    await expect(row).toHaveCSS("animation-duration", "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(row).toHaveCSS("animation-duration", "0s");
  });

  test("a category added slides in from the side in 200 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("categorytree", "added"));
    await page.getByRole("button", { name: "Add Pets" }).click();

    const added = page.locator('[data-slot="category-row"]', { hasText: "Pets" });

    await expect(added).toHaveCSS("animation-duration", "0.2s");
    // Not staggered with the first paint's rows: it comes at once.
    await expect(added).toHaveCSS("animation-delay", "0s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(added).toHaveCSS("animation-duration", "0s");
  });
});

test.describe("CategoryPicker", () => {
  test("finds a child by its parent's name, and chooses it", async ({ page }) => {
    await page.goto(story("categorypicker", "default"));

    const input = page.getByRole("combobox", { name: "Category" });

    await input.pressSequentially("groc");
    await expect(page.getByRole("option")).toHaveText([
      "Groceries",
      "Groceries › Supermarket",
      "Groceries › Bakery",
    ]);
    await page.getByRole("option", { name: "Groceries › Bakery" }).click();
    await expect(input).toHaveValue("Groceries › Bakery");
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: bakery");
  });

  test("shows the chosen child with its parent", async ({ page }) => {
    await page.goto(story("categorypicker", "chosen"));
    await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue(
      "Groceries › Bakery",
    );
  });

  test("its list fades in in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("categorypicker", "default"));
    await page.getByRole("combobox", { name: "Category" }).pressSequentially("h");

    const popup = page.locator('[data-slot="combobox-content"]');

    await expect(popup).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(popup).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("LineDetail with its category", () => {
  test("shows the picker first, with the line's category", async ({ page }) => {
    await page.goto("/iframe.html?id=operations-linedetail--with-category&viewMode=story");
    await expect(page.locator('[data-slot="line-category"]')).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue(
      "Groceries › Supermarket",
    );
  });
});

test.describe("OperationsList with categories", () => {
  test("shows a Category column on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/iframe.html?id=operations-operationslist--with-category&viewMode=story");
    await expect(
      page.locator('[data-slot="operation-row"]').first().getByText("Groceries › Supermarket"),
    ).toBeVisible();
  });
});
