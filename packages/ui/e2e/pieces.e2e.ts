import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

test.describe("ErrorState", () => {
  test("the error is announced, with a general text by default", async ({ page }) => {
    await page.goto(story("states-errorstate--default"));

    const alert = page.getByRole("alert");

    await expect(alert).toContainText("This could not be loaded");
    await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  test("Retry runs, and shows the loader while its promise runs", async ({ page }) => {
    await page.goto(story("states-errorstate--retry-then-loaded"));

    const retry = page.getByRole("button", { name: "Retry" });

    await retry.click();
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await expect(retry.locator('[data-slot="loader"]')).toBeVisible();
    await expect(page.getByText("No lines this month")).toBeVisible({ timeout: 4000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("the error is said in French on a French page", async ({ page }) => {
    await page.goto(story("states-errorstate--default"));
    await page.evaluate(() => {
      document.documentElement.lang = "fr";
    });
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  });
});

test.describe("EmptyState", () => {
  test("says what is missing, and its action works", async ({ page }) => {
    await page.goto(story("states-emptystate--with-action"));
    await expect(page.getByText("No lines this month")).toBeVisible();
    await page.getByRole("button", { name: "Import statements" }).click();
    await expect(page.getByRole("status")).toHaveText("Import started");
  });

  test("compact and block take their own room", async ({ page }) => {
    await page.goto(story("states-emptystate--compact"));
    await expect(page.locator('[data-slot="state"]')).toHaveAttribute("data-size", "compact");
  });
});

test.describe("CategoryIcon", () => {
  test("is decorative beside a name, and the uncategorised form says so", async ({ page }) => {
    await page.goto(story("data-categoryicon--in-rows"));
    await expect(page.getByRole("img")).toHaveCount(1);
    await expect(page.getByRole("img", { name: "Uncategorised" })).toBeVisible();
  });

  test("draws an icon, never an emoji", async ({ page }) => {
    await page.goto(story("data-categoryicon--default"));

    const tile = page.locator('[data-slot="category-icon"]');

    await expect(tile.locator("svg")).toHaveCount(1);
    await expect(tile).toHaveText("");
  });
});

test.describe("MerchantLogo", () => {
  test("shows the logo when it loads", async ({ page }) => {
    await page.goto(story("data-merchantlogo--with-logo"));

    const logo = page.locator('[data-slot="merchant-logo"] img');

    await expect(logo).toHaveAttribute("alt", "");
    await expect(logo).toHaveAttribute("loading", "lazy");
    await expect(logo).toBeVisible();
  });

  test("falls back to the initials when its image fails", async ({ page }) => {
    await page.goto(story("data-merchantlogo--broken-logo"));

    const tile = page.locator('[data-slot="merchant-logo"]');

    await expect(tile).toHaveText("F");
    await expect(tile.locator("img")).toHaveCount(0);
  });

  test("a name keeps the same tile", async ({ page }) => {
    await page.goto(story("data-merchantlogo--in-rows"));

    const first = await page.locator('[data-slot="merchant-logo"]').first().getAttribute("class");

    await page.reload();
    await expect(page.locator('[data-slot="merchant-logo"]').first()).toHaveAttribute(
      "class",
      first ?? "",
    );
  });
});

test.describe("AccountChip", () => {
  test("shows the account's name", async ({ page }) => {
    await page.goto(story("data-accountchip--paid-with"));
    await expect(page.getByText("MealCard")).toBeVisible();
  });

  test("a removable chip is taken out by its labelled cross", async ({ page }) => {
    await page.goto(story("data-accountchip--removable"));

    const remove = page.getByRole("button", { name: "Remove Livret A" });

    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Livret A")).toHaveCount(0);
    await expect(page.locator('[data-slot="account-chip"]')).toHaveCount(2);
  });
});
