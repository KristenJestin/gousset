import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=operations-linefunding--${name}&viewMode=story`;

test.describe("LineFunds", () => {
  test("offers the expenses a refund may fund, the nearest checked, and funds the one chosen", async ({
    page,
  }) => {
    await page.goto(story("candidates"));

    const block = page.getByRole("region", { name: "Funds an expense" });

    await expect(block).toContainText("which keeps its cost");
    await block.getByRole("button", { name: "Fund an expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Fund an expense" });

    await expect(dialog.getByRole("radio")).toHaveCount(2);
    await expect(dialog.getByRole("radio").first()).toBeChecked();
    await expect(dialog).toContainText("Leisure › Sport");
    await expect(dialog).toContainText("CB RIVERSIDE SPORTS CLUB 0210");
    await expect(dialog).toContainText("€120.00");

    await dialog.getByRole("radio").nth(1).check();
    await dialog.getByRole("button", { name: "Fund", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("says when no expense may be funded, and funds nothing", async ({ page }) => {
    await page.goto(story("no-candidate"));
    await page.getByRole("button", { name: "Fund an expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Fund an expense" });

    await expect(dialog).toContainText(
      "No expense of the 90 days before it costs at least this refund.",
    );
    await expect(dialog.getByRole("button", { name: "Fund", exact: true })).toBeDisabled();
  });

  test("shows the expense it funds, one click from its line, and unfunds it", async ({ page }) => {
    await page.goto(story("funds"));

    const block = page.getByRole("region", { name: "Funds an expense" });

    await expect(
      block.getByRole("button", { name: /CB RIVERSIDE SPORTS CLUB 0210/ }),
    ).toBeVisible();
    await expect(block).toContainText("The expense keeps its cost");
    await expect(block.getByRole("button", { name: "Fund an expense" })).toHaveCount(0);
    await expect(block.getByRole("button", { name: "Unfund" })).toBeEnabled();
  });

  test("shows a refusal under the block", async ({ page }) => {
    await page.goto(story("refused"));
    await expect(page.getByText("This refund is more than that expense still costs")).toBeVisible();
  });

  test("its dialog fades and grows in 200 ms (rises in 300 ms on a phone), and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("candidates"));

    const dialog = page.getByRole("dialog", { name: "Fund an expense" });
    const wide = (page.viewportSize()?.width ?? 0) >= 768;

    await page.getByRole("button", { name: "Fund an expense" }).click();
    await expect(dialog).toHaveCSS("transition-duration", wide ? "0.2s" : "0.3s");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Fund an expense" }).click();
    await expect(dialog).toHaveCSS("transition-duration", "0s");
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("french"));
    await expect(page.getByRole("region", { name: "Finance une dépense" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ne plus financer" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Financée par" })).toContainText(
      "Financé au total",
    );
  });
});

test.describe("LineFundedBy", () => {
  test("lists the refunds funding an expense, each one click from its line, and keeps its cost", async ({
    page,
  }) => {
    await page.goto(story("funded-by"));

    const block = page.getByRole("region", { name: "Funded by" });

    await expect(block.locator('[data-slot="funding"]')).toHaveCount(1);
    await expect(block.getByRole("button", { name: /PERKSHUB REFUND 0042/ })).toBeVisible();
    await expect(block).toContainText("PerksHub");
    await expect(block.locator('[data-slot="funded-total"]')).toContainText("€80.00");
    await expect(block.locator('[data-slot="funded-cost"]')).toHaveText(
      "It keeps its cost of €120.00.",
    );
  });

  test("a funding's hover colour moves in 150 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("funded-by"));

    const funding = page.locator('[data-slot="funding"] button').first();

    await expect(funding).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(funding).toHaveCSS("transition-duration", "0s");
  });
});
