import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

test.describe("ErrorState", () => {
  test("the error is announced, with a general text by default", async ({ page }) => {
    await page.goto(story("states-errorstate--default"));

    const alert = page.getByRole("alert");

    await expect(alert).toContainText("This block could not be loaded");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("Try again runs, and shows the loader while its promise runs", async ({ page }) => {
    await page.goto(story("states-errorstate--retry-then-loaded"));

    const retry = page.getByRole("button", { name: "Try again" });

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

  test("falls back to the initials when its image failed before hydration", async ({ page }) => {
    await page.goto(story("data-merchantlogo--broken-before-hydration"));

    const tile = page.getByTestId("hydrated-after-failure").locator('[data-slot="merchant-logo"]');

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

/** The month as it is announced. */
const month = (page: Page) => page.locator('[data-slot="month-switcher"] [aria-live]');

/**
 * Presses previous and, at every frame for 500 ms, counts the labels drawn (not fully
 * transparent): returns how many frames drew two at once, as they do while they slide.
 *
 * What is drawn, not what is in the DOM: a leaving label stays in the DOM until Motion's exit
 * ends and React renders again, a frame or two later even when reduced motion skips the exit
 * (it is made transparent at once), so counting labels would measure React's scheduling, not
 * the motion.
 */
async function framesWithTwoLabels(page: Page) {
  return page.getByRole("button", { name: "Previous month", exact: true }).evaluate(
    (button) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        let frames = 0;

        const sample = () => {
          const drawn = [...document.querySelectorAll('[data-slot="month-label"]')].filter(
            (label) => Number(getComputedStyle(label).opacity) > 0,
          );

          if (drawn.length > 1) {
            frames += 1;
          }

          if (performance.now() - start < 500) {
            requestAnimationFrame(sample);
          } else {
            resolve(frames);
          }
        };

        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        requestAnimationFrame(sample);
      }),
  );
}

test.describe("MonthSwitcher", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  });

  test("moves by pointer, and stops at the latest month", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    await expect(month(page)).toHaveText("October 2026");

    const previous = page.getByRole("button", { name: "Previous month", exact: true });
    const next = page.getByRole("button", { name: "Next month", exact: true });

    await previous.click();
    await expect(month(page)).toHaveText("September 2026");
    await next.click();
    await next.click();
    await expect(month(page)).toHaveText("November 2026");
    await expect(next).toBeDisabled();
  });

  test("moves by keyboard, with the arrows", async ({ page }) => {
    await page.goto(story("data-monthswitcher--january"));
    await page.getByRole("button", { name: "Previous month", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(month(page)).toHaveText("December 2025");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(month(page)).toHaveText("February 2026");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(month(page)).toHaveText("January 2026");
  });

  test("next is disabled on the current month", async ({ page }) => {
    await page.goto(story("data-monthswitcher--current-month"));
    await expect(month(page)).toHaveText("October 2026");
    await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Previous month", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(month(page)).toHaveText("October 2026");
  });

  test("the focus stays on next when it turns disabled, and the arrows still move", async ({
    page,
  }) => {
    await page.goto(story("data-monthswitcher--default"));
    await expect(month(page)).toHaveText("October 2026");

    const next = page.getByRole("button", { name: "Next month", exact: true });

    await next.focus();
    await page.keyboard.press("Enter");
    await expect(month(page)).toHaveText("November 2026");
    await expect(next).toBeDisabled();
    await expect(next).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(month(page)).toHaveText("October 2026");
  });

  test("names the month in French on a French page", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    await page.evaluate(() => {
      document.documentElement.lang = "fr";
    });
    await expect(month(page)).toHaveText("octobre 2026");
    await expect(page.getByRole("button", { name: "Mois précédent", exact: true })).toBeVisible();
  });

  test("the label slides, and changes at once under reduced motion", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    // The slide lasts 200 ms: most of its dozen frames draw both labels.
    expect(await framesWithTwoLabels(page)).toBeGreaterThan(4);
    await expect(page.locator('[data-slot="month-label"]')).toHaveCount(1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    expect(await framesWithTwoLabels(page)).toBe(0);
    await expect(month(page)).toHaveText("September 2026");
  });
});

test.describe("List", () => {
  test("its skeleton is as tall as the loaded list, and says it is loading", async ({ page }) => {
    await page.goto(story("data-list--loading-beside-loaded"));

    const loaded = await page.getByRole("list", { name: "Users" }).boundingBox();
    const skeleton = await page.locator('[data-slot="list-skeleton"]').boundingBox();

    expect(loaded?.height).toBeGreaterThan(0);
    expect(skeleton?.height).toBe(loaded?.height);
    await expect(page.getByRole("status", { name: "Loading" })).toHaveAttribute(
      "aria-busy",
      "true",
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
