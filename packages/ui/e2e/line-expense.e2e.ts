import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=operations-lineexpense--${name}&viewMode=story`;

test.describe("LineExpense", () => {
  test("shows an expense's payments and refunds, each one click from its line, and its net cost once", async ({
    page,
  }) => {
    await page.goto(story("linked"));

    const expense = page.getByRole("region", { name: "One expense, counted once" });

    await expect(expense.locator('[data-slot="expense-part"]')).toHaveCount(3);
    // The open line is marked, no button; the others open their line.
    await expect(expense.locator('[data-slot="expense-part"][data-current]')).toHaveCount(1);
    await expect(expense.getByRole("button", { name: /Travel card/ })).toBeVisible();
    await expect(expense.locator('[data-slot="expense-net"]')).toContainText("Net cost");
    await expect(expense.locator('[data-slot="expense-net"]')).toContainText("€55.00");
  });

  test("asks before separating a line", async ({ page }) => {
    await page.goto(story("linked"));
    await page.getByRole("button", { name: "Separate this line" }).click();

    const question = page.getByRole("alertdialog", { name: "Separate this line?" });

    await expect(question).toBeVisible();
    await question.getByRole("button", { name: "Cancel" }).click();
    await expect(question).toHaveCount(0);
  });

  test("shows a split line's shares", async ({ page }) => {
    await page.goto(story("split"));

    const shares = page.getByRole("region", { name: "Split across 2 categories" });

    await expect(shares.locator('[data-slot="expense-share"]')).toHaveCount(2);
    await expect(shares).toContainText("Shopping › Home and garden");
  });

  test("proposes a refund and asks before linking it", async ({ page }) => {
    await page.goto(story("proposed"));

    const proposal = page.getByRole("region", { name: "Maybe a refund" });

    await expect(proposal).toContainText("Eating out › Restaurants · costs €56.00");
    await proposal.getByRole("button", { name: "Link as a refund" }).click();
    await expect(page.getByRole("alertdialog", { name: "Link as a refund?" })).toBeVisible();
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("french"));
    await expect(
      page.getByRole("region", { name: "Une seule dépense, comptée une fois" }),
    ).toBeVisible();
    await expect(page.getByText("Peut-être un remboursement")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lier à une dépense" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Répartir" })).toBeVisible();
  });

  test("a part's hover colour moves in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("linked"));

    const part = page.locator('[data-slot="expense-part"] button').first();

    await expect(part).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(part).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("LinkLine", () => {
  test("finds a line of the expense and links only once one is chosen", async ({ page }) => {
    await page.goto(story("linked"));
    await page.getByRole("button", { name: "Link to an expense" }).click();

    const dialog = page.getByRole("dialog", { name: "Link to an expense" });

    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("button", { name: "Link", exact: true })).toBeDisabled();

    await dialog.getByRole("searchbox", { name: "Search a line" }).fill("bistro");
    await expect(dialog.getByRole("radio")).toHaveCount(1);
    await dialog.getByRole("radio").check();
    await dialog.getByRole("button", { name: "Link", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("says when no line matches", async ({ page }) => {
    await page.goto(story("linked"));
    await page.getByRole("button", { name: "Link to an expense" }).click();
    await page.getByRole("searchbox", { name: "Search a line" }).fill("nothing like this");
    await expect(page.getByText("No line matches.")).toBeVisible();
  });
});

test.describe("SplitLine", () => {
  test("says what is left to place, and saves only once the shares make the whole line", async ({
    page,
  }) => {
    await page.goto(story("split-sheet"));
    await page.getByRole("button", { name: "Split", exact: true }).click();

    const sheet = page.getByRole("dialog", { name: "Split across categories" });
    const left = sheet.locator('[data-slot="split-left"]');
    const save = sheet.getByRole("button", { name: "Save the split" });

    await expect(left).toHaveText("The shares make the whole line.");
    await expect(save).toBeEnabled();

    await sheet.getByRole("textbox", { name: "Amount 1" }).fill("30");
    await expect(left).toHaveText("€60.00 left to place");
    await expect(save).toBeDisabled();

    // A new share takes what is left; without its category, nothing is saved yet.
    await sheet.getByRole("button", { name: "Add a category" }).click();
    await expect(sheet.getByRole("textbox", { name: "Amount 2" })).toHaveValue("60.00");
    await expect(left).toHaveText("The shares make the whole line.");
    await expect(save).toBeDisabled();

    await sheet.getByRole("combobox", { name: "Category 2" }).pressSequentially("home");
    await page.getByRole("option", { name: "Shopping › Home and garden" }).click();
    await expect(save).toBeEnabled();

    await sheet.getByRole("textbox", { name: "Amount 2" }).fill("70");
    await expect(left).toHaveText("€10.00 too much");
    await expect(save).toBeDisabled();

    await sheet.getByRole("button", { name: "Remove share 2" }).click();
    await expect(sheet.locator('[data-slot="split-share"]')).toHaveCount(1);
  });

  test("saves the shares and closes once they make the whole line", async ({ page }) => {
    await page.goto(story("split-sheet"));
    await page.getByRole("button", { name: "Split", exact: true }).click();

    const sheet = page.getByRole("dialog", { name: "Split across categories" });

    await sheet.getByRole("textbox", { name: "Amount 1" }).fill("30");
    await sheet.getByRole("button", { name: "Add a category" }).click();
    await sheet.getByRole("combobox", { name: "Category 2" }).pressSequentially("home");
    await page.getByRole("option", { name: "Shopping › Home and garden" }).click();
    await expect(sheet.locator('[data-slot="split-left"]')).toHaveText(
      "The shares make the whole line.",
    );

    await sheet.getByRole("button", { name: "Save the split" }).click();
    await expect(sheet).toHaveCount(0);
  });
});
