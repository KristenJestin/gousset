import { expect, test } from "@playwright/test";

// What Gousset proposes for a line to review (#35) on its stories: the proposal and its two
// buttons, named with the action and the line; Correct's dialog corrects in the category chosen, a
// refusal stays in it; a held repeat is kept with no dialog; at the top of the line's detail,
// focused when it opens; its words in French, and its dialog's motion.

const story = (name: string) => `/iframe.html?id=operations-reviewproposal--${name}&viewMode=story`;

const LABEL = "CB GREENMARKET 2110 RIVERTON";

test.describe("ReviewProposal", () => {
  test("says what Gousset proposes, with Accept and Correct named after the line", async ({
    page,
  }) => {
    await page.goto(story("category"));

    const block = page.locator('[data-slot="review-proposal"]');

    await expect(block).toHaveAttribute("data-kind", "category");
    await expect(block).toContainText("Gousset proposes");
    await expect(block).toContainText("Keep it in Groceries › Supermarket (Greenmarket).");
    await expect(
      block.getByRole("button", { name: `Accept the proposal for ${LABEL}` }),
    ).toBeVisible();
    await expect(block.getByRole("button", { name: `Correct ${LABEL}` })).toBeVisible();
  });

  test("Accept is busy while it runs, then done", async ({ page }) => {
    await page.goto(story("category"));

    const accept = page.getByRole("button", { name: `Accept the proposal for ${LABEL}` });

    await accept.click();
    await expect(accept).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("done")).toHaveText("Accepted");
  });

  test("Correct opens the dialog on the line's category, and corrects in the one chosen", async ({
    page,
  }) => {
    await page.goto(story("category"));
    await page.getByRole("button", { name: `Correct ${LABEL}` }).click();

    const dialog = page.getByRole("dialog", { name: "Correct this line" });
    const picker = dialog.getByRole("combobox", { name: "Category" });

    await expect(dialog).toContainText(`The category ${LABEL} goes in, as your choice.`);
    await expect(picker).toHaveValue("Groceries › Supermarket");
    await picker.fill("");
    await picker.pressSequentially("bak");
    await page.getByRole("option", { name: "Groceries › Bakery" }).click();
    await dialog.getByRole("button", { name: "Correct the line" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("done")).toHaveText("Corrected: bakery");
  });

  test("a refusal shows under the field, and the dialog stays open", async ({ page }) => {
    await page.goto(story("refused"));
    await page.getByRole("button", { name: `Correct ${LABEL}` }).click();

    const dialog = page.getByRole("dialog", { name: "Correct this line" });
    const picker = dialog.getByRole("combobox", { name: "Category" });

    await dialog.getByRole("button", { name: "Correct the line" }).click();
    await expect(picker).toHaveAttribute("aria-invalid", "true");
    await expect(picker).toHaveAccessibleDescription(/That category is archived/);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("done")).toHaveText("Nothing done");
  });

  test("Cancel changes nothing", async ({ page }) => {
    await page.goto(story("category"));
    await page.getByRole("button", { name: `Correct ${LABEL}` }).click();

    const dialog = page.getByRole("dialog", { name: "Correct this line" });

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("done")).toHaveText("Nothing done");
  });

  test("a held repeat is kept with no dialog", async ({ page }) => {
    await page.goto(story("duplicate"));

    const block = page.locator('[data-slot="review-proposal"]');

    await expect(block).toHaveAttribute("data-kind", "duplicate");
    await expect(block).toContainText("Discard it: it repeats the line of Oct. 21");

    await block.getByRole("button", { name: "Keep it: GREENMARKET RIVERTON is no repeat" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("done")).toHaveText("Kept");
  });

  test("with nothing to accept, Correct alone", async ({ page }) => {
    await page.goto(story("nothing-to-accept"));

    const block = page.locator('[data-slot="review-proposal"]');

    await expect(block.getByRole("button")).toHaveCount(1);
    await expect(block.getByRole("button", { name: `Correct ${LABEL}` })).toBeVisible();
  });

  test("what the page says shows under the buttons", async ({ page }) => {
    await page.goto(story("changed"));
    await expect(page.getByRole("alert")).toHaveText(
      "Its proposal changed meanwhile: here is the new one.",
    );
  });

  test("at the top of the line's detail, focused when it opens, and Tab reaches each button", async ({
    page,
  }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1024, "Below 1024 px the detail is a sheet");

    await page.goto(story("in-detail"));

    const slot = page.locator('[data-slot="line-detail-content"] [data-slot="line-review"]');

    await expect(slot).toContainText("Gousset proposes");
    await expect(slot).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: `Accept the proposal for ${LABEL}` }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: `Correct ${LABEL}` })).toBeFocused();
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("french"));
    await expect(page.getByText("Gousset propose").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Accepter la proposition pour/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^La garder : / })).toBeVisible();
    await page.getByRole("button", { name: /^Corriger / }).click();
    await expect(page.getByRole("dialog", { name: "Corriger cette ligne" })).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Corriger la ligne" }),
    ).toBeVisible();
  });

  test("the block does not move, its dialog grows in in 200 ms (rises in 300 ms on a phone), and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("category"));
    await expect(page.locator('[data-slot="review-proposal"]')).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: `Correct ${LABEL}` }).click();

    const dialog = page.getByRole("dialog", { name: "Correct this line" });
    const wide = (page.viewportSize()?.width ?? 0) >= 768;

    await expect(dialog).toHaveCSS("transition-duration", wide ? "0.2s" : "0.3s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog).toHaveCSS("transition-duration", "0s");
  });
});
