import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (title: string, name: string) => `/iframe.html?id=${title}--${name}&viewMode=story`;

/** The longest transition of an element, in seconds, as the browser computes it. */
async function transitionSeconds(element: Locator) {
  const durations = await element.evaluate((node) => getComputedStyle(node).transitionDuration);

  return Math.max(...durations.split(",").map((value) => Number.parseFloat(value)));
}

test.describe("IconButton", () => {
  test("its name is its label, and its tooltip shows on focus", async ({ page }) => {
    await page.goto(story("actions-iconbutton", "ghost"));

    const button = page.getByRole("button", { name: "More actions" });

    await expect(button).toBeVisible();
    await expect(page.getByRole("tooltip")).toBeHidden();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expect(page.getByRole("tooltip")).toHaveText("More actions");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("it is square, at the heights of Button", async ({ page }) => {
    await page.goto(story("actions-iconbutton", "variants"));

    const regular = await page
      .getByRole("button", { name: "Previous month" })
      .first()
      .boundingBox();
    const small = await page.getByRole("button", { name: "More actions" }).first().boundingBox();

    expect(regular).toMatchObject({ width: 36, height: 36 });
    expect(small).toMatchObject({ width: 32, height: 32 });
  });

  test("while loading, it is busy, refuses presses and shows the loader", async ({ page }) => {
    await page.goto(story("actions-iconbutton", "loading"));

    const button = page.getByRole("button", { name: "Refresh the accounts" });

    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button.locator('[data-slot="loader"]')).toBeVisible();
  });

  test("a disabled icon button cannot be pressed", async ({ page }) => {
    await page.goto(story("actions-iconbutton", "disabled"));
    await expect(page.getByRole("button", { name: "More actions" })).toBeDisabled();
  });

  test("its tooltip fades in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("actions-iconbutton", "ghost"));
    await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
    await page.keyboard.press("Tab");

    const tooltip = page.getByRole("tooltip");

    await expect(tooltip).toBeVisible();
    expect(await transitionSeconds(tooltip)).toBe(0.15);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await transitionSeconds(tooltip)).toBe(0);
  });
});
