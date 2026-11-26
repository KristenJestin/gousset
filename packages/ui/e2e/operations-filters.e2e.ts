import { expect, test } from "@playwright/test";

const story = (name: string) =>
  `/iframe.html?id=operations-operationsfilters--${name}&viewMode=story`;

// Issue #184: in the row, "To review only" is one toggle button, pressed or not, with no box
// drawn inside it. The phone folds it into the sheet, where it is a plain checkbox and its label.
test.describe("To review only, in the row", () => {
  test.skip(({ isMobile }) => isMobile, "A phone folds the row into the sheet");

  test("it is one toggle button, off then pressed by a click, with no box inside", async ({
    page,
  }) => {
    await page.goto(story("default"));

    const filters = page.getByRole("group", { name: "Filters" });
    const toggle = filters.getByRole("button", { name: "To review only" });

    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(filters.getByRole("checkbox")).toHaveCount(0);

    const off = await toggle.evaluate((element) => getComputedStyle(element).borderColor);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.locator("*")).toHaveCount(0);
    await expect(toggle).not.toHaveCSS("border-color", off);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveCSS("border-color", off);
  });

  test("it is reached by Tab, pressed by Space and Enter, and its focus ring is drawn", async ({
    page,
  }) => {
    await page.goto(story("default"));

    const filters = page.getByRole("group", { name: "Filters" });
    const toggle = filters.getByRole("button", { name: "To review only" });

    // The field before it, then Tab: the keyboard's way in.
    await filters.getByRole("textbox", { name: "Amount up to" }).focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveCSS("outline-style", "solid");
    await expect(toggle).toHaveCSS("outline-width", "2px");
    await expect(toggle).toHaveCSS("outline-offset", "2px");

    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("set, it shows pressed from the first paint", async ({ page }) => {
    await page.goto(story("set"));

    await expect(
      page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "To review only" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("its colours move in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("default"));

    const toggle = page
      .getByRole("group", { name: "Filters" })
      .getByRole("button", { name: "To review only" });

    await expect(toggle).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(toggle).toHaveCSS("transition-duration", "0s");
  });
});
