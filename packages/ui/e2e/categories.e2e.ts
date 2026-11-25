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

const formsStory = (component: string, name: string) =>
  `/iframe.html?id=forms-${component}--${name}&viewMode=story`;

test.describe("ColorSwatches (#205)", () => {
  test("chooses a colour by its name, with the arrow keys too", async ({ page }) => {
    await page.goto(formsStory("colorswatches", "default"));

    const group = page.getByRole("radiogroup", { name: "Colour" });

    await expect(group.getByRole("radio")).toHaveCount(12);
    await expect(group.getByRole("radio", { name: "Green" })).toBeChecked();
    await group.getByRole("radio", { name: "Blue" }).click();
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: blue");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: indigo");
  });

  test("offers no colour first, standing for the parent's", async ({ page }) => {
    await page.goto(formsStory("colorswatches", "parentscolour"));

    const none = page.getByRole("radio", { name: "As Housing" });

    await expect(page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio")).toHaveCount(
      13,
    );
    await expect(none).toBeChecked();
    await page.getByRole("radio", { name: "Pink" }).click();
    await none.click();
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: none");
  });

  test("names its colours in French", async ({ page }) => {
    await page.goto(formsStory("colorswatches", "french"));
    await expect(page.getByRole("radio", { name: "Bleu canard" })).toBeChecked();
  });

  test("the chosen swatch's ring fades in 150 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(formsStory("colorswatches", "default"));

    const chosen = page.getByRole("radio", { name: "Green" });

    await expect(chosen).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(chosen).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("CategoryIconChoice (#205)", () => {
  test("chooses an icon by what it means, drawn in the category's colour", async ({ page }) => {
    await page.goto(formsStory("categoryiconchoice", "default"));

    const group = page.getByRole("radiogroup", { name: "Icon" });

    await expect(group.getByRole("radio", { name: "Groceries" })).toBeChecked();
    await group.getByRole("radio", { name: "Bakery" }).click();
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: bakery");
    await expect(group.getByRole("radio", { name: "Bakery" })).toHaveClass(
      /data-checked:text-palette-green/,
    );
  });

  test("its tiles' colours change in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(formsStory("categoryiconchoice", "default"));

    const tile = page.getByRole("radio", { name: "Bakery" });

    await expect(tile).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(tile).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("A category's colour where it is named (#205)", () => {
  test("tints its tile in the settings' tree; a child takes its parent's", async ({ page }) => {
    await page.goto(story("categorytree", "default"));

    const tile = (name: string) =>
      page
        .locator('[data-slot="category-row"]')
        .filter({ hasText: new RegExp(`^${name}`) })
        .locator('[data-slot="category-icon"]');

    await expect(tile("Housing")).toHaveAttribute("data-color", "blue");
    await expect(tile("Rent")).toHaveAttribute("data-color", "blue");
    await expect(tile("Energy")).toHaveAttribute("data-color", "amber");
    // None: a neutral tile, `other`'s drawing.
    await expect(tile("Other")).not.toHaveAttribute("data-color");
    await expect(tile("Other")).toHaveAttribute("data-icon", "other");
  });

  test("draws the picker's choices and the chosen one in their colours", async ({ page }) => {
    await page.goto(story("categorypicker", "chosen"));

    // The chosen one's icon, before the input, in its colour.
    await expect(page.locator('[data-icon="bakery"][data-color="green"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Show the options" }).click();
    await expect(
      page.getByRole("option", { name: "Housing › Energy" }).locator('[data-color="amber"]'),
    ).toBeVisible();
  });

  test("draws a breakdown row's icon and bar in its colour", async ({ page }) => {
    await page.goto("/iframe.html?id=money-breakdown--default&viewMode=story");

    const housing = page.locator("li").filter({ hasText: "Housing" });

    await expect(housing.locator('[data-slot="breakdown-icon"]')).toHaveAttribute(
      "data-color",
      "blue",
    );
    await expect(housing.locator('[data-slot="breakdown-fill"]')).toHaveAttribute(
      "data-color",
      "blue",
    );
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
