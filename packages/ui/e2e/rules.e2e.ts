import { expect, test } from "@playwright/test";

// The rules' components (#25) on their stories: the list, the conditions editor, the editor's
// sheet and a correction's proposal, their words in both languages and their motion.

const story = (component: string, name: string) =>
  `/iframe.html?id=rules-${component}--${name}&viewMode=story`;

test.describe("RulesList", () => {
  test("says each rule as a sentence, with what it sets and how many lines it classified", async ({
    page,
  }) => {
    await page.goto(story("ruleslist", "default"));

    const rows = page.locator('[data-slot="rule-row"]');

    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("label contains “GREENMARKET”");
    await expect(rows.first()).toContainText("128 times");
    await expect(rows.nth(2)).toContainText(
      "label starts with “CB FUELSTOP” and account is Current account and money goes out",
    );
    await expect(rows.nth(3)).toContainText("amount is 610 and day between 3 and 7");
  });

  test("a rule turned off is said so, and one whose category is archived too", async ({ page }) => {
    await page.goto(story("ruleslist", "turned-off"));
    await expect(page.locator('[data-slot="rule-row"][data-enabled="false"]')).toContainText("Off");

    await page.goto(story("ruleslist", "archived-category"));
    await expect(page.locator('[data-slot="rule-row"]').nth(3)).toContainText("archived");
  });

  test("pressing a rule opens it", async ({ page }) => {
    await page.goto(story("ruleslist", "default"));
    await page.getByRole("button", { name: "label contains “GREENMARKET”" }).click();
    await expect(page.getByTestId("opened")).toHaveText("Opened: rule-greenmarket");
  });

  test("a rule moved up takes its place, and keeps the focus on its arrows", async ({ page }) => {
    await page.goto(story("ruleslist", "default"));
    await page.getByRole("button", { name: "Move rule 2 up" }).click();

    const first = page.locator('[data-slot="rule-row"]').first();

    await expect(first).toContainText("PAYLINK *PIXELPLAY");
    await expect(page.getByRole("button", { name: "Move rule 1 up" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Move rule 1 down" })).toBeFocused();
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("ruleslist", "french"));
    await expect(page.getByText("Utilisée")).toBeVisible();
    await expect(page.locator('[data-slot="rule-row"]').first()).toContainText(
      "le libellé contient « GREENMARKET »",
    );
    await expect(page.getByRole("button", { name: "Monter la règle 2" })).toBeVisible();
  });

  test("its rows fade in in 200 ms, a rule moved slides in in 200 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("ruleslist", "default"));

    const first = page.locator('[data-slot="rule-row"]').first();

    await expect(first).toHaveCSS("animation-duration", "0.2s");
    await page.getByRole("button", { name: "Move rule 2 up" }).click();
    await expect(first).toContainText("PAYLINK");
    await expect(first).toHaveCSS("animation-duration", "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(first).toHaveCSS("animation-duration", "0s");
  });
});

test.describe("RuleConditionsEditor", () => {
  test("adds conditions up to ten, and removes one", async ({ page }) => {
    await page.goto(story("ruleconditionseditor", "empty"));

    const add = page.getByRole("button", { name: "Add a condition" });

    for (let added = 1; added < 10; added += 1) {
      await add.click();
    }

    await expect(page.locator('[data-slot="rule-condition"]')).toHaveCount(10);
    await expect(add).toBeDisabled();
    await expect(page.getByText("10 conditions at most.")).toBeVisible();

    await page.getByRole("button", { name: "Remove condition 10" }).click();
    await expect(page.locator('[data-slot="rule-condition"]')).toHaveCount(9);
    await expect(add).toBeEnabled();
  });

  test("a label typed gives complete conditions", async ({ page }) => {
    await page.goto(story("ruleconditionseditor", "empty"));
    await page.getByRole("textbox", { name: "Value of condition 1" }).fill("CORNER BISTRO");
    await expect(page.getByTestId("conditions")).toContainText('"value":"CORNER BISTRO"');
  });

  test("between takes two values", async ({ page }) => {
    await page.goto(story("ruleconditionseditor", "amount-and-day"));
    await expect(page.getByRole("textbox", { name: "Lowest value of condition 2" })).toHaveValue(
      "3",
    );
    await expect(page.getByRole("textbox", { name: "Highest value of condition 2" })).toHaveValue(
      "7",
    );
  });

  test("another field takes its own control", async ({ page }) => {
    await page.goto(story("ruleconditionseditor", "default"));
    await page.getByRole("combobox", { name: "Field of condition 1" }).click();
    await page.getByRole("option", { name: "Direction" }).click();
    await expect(page.getByRole("combobox", { name: "Value of condition 1" })).toBeVisible();
  });

  test("a condition added slides in in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("ruleconditionseditor", "default"));
    await page.getByRole("button", { name: "Add a condition" }).click();

    const added = page.locator('[data-slot="rule-condition"]').nth(1);

    await expect(added).toHaveCSS("animation-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(added).toHaveCSS("animation-duration", "0s");
  });
});

test.describe("RuleEditor", () => {
  test("says its effect before saving, and what was classified by hand", async ({ page }) => {
    await page.goto(story("ruleeditor", "default"));

    const sheet = page.getByRole("dialog", { name: "Rule 1" });

    await expect(sheet.locator('[data-slot="rule-reach"]')).toHaveText(
      "Applies to 128 existing lines. 3 of them were classified otherwise by hand.",
    );
    await expect(sheet.getByRole("checkbox", { name: "Reclassify them too" })).not.toBeChecked();
    await expect(sheet).toContainText("Created on Mar 4, 2026 while correcting a line");
  });

  test("applied to the past, it says how many lines changed", async ({ page }) => {
    await page.goto(story("ruleeditor", "default"));
    await page.getByRole("button", { name: "Apply to the past" }).click();
    await expect(page.locator('[data-slot="rule-applied"]')).toHaveText("12 lines changed");
  });

  test("a change waits for Save before applying to the past", async ({ page }) => {
    await page.goto(story("ruleeditor", "default"));
    await page.getByRole("switch", { name: "On" }).click();
    await expect(page.getByRole("button", { name: "Apply to the past" })).toBeDisabled();
    await expect(page.getByText("Save your changes before applying the rule.")).toBeVisible();
  });

  test("a new rule asks what to apply once made", async ({ page }) => {
    await page.goto(story("ruleeditor", "new"));
    await expect(page.getByRole("dialog", { name: "New rule" })).toContainText(
      "Complete the conditions to see the lines it applies to.",
    );

    await page.goto(story("ruleeditor", "new-with-effect"));
    await expect(
      page.getByRole("checkbox", { name: "Also apply to the 14 lines already there" }),
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("an archived category is named, and kept", async ({ page }) => {
    await page.goto(story("ruleeditor", "archived-category"));
    await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue(
      "Food › Old groceries",
    );
    await expect(page.getByText("Food › Old groceries is archived")).toBeVisible();
  });

  test("Save sends the draft", async ({ page }) => {
    await page.goto(story("ruleeditor", "default"));
    await page.getByRole("textbox", { name: "Value of condition 1" }).fill("GREENMARKET RIVERTON");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("saved")).toContainText('"value":"GREENMARKET RIVERTON"');
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("ruleeditor", "french"));

    const sheet = page.getByRole("dialog", { name: "Règle 1" });

    await expect(sheet).toContainText("en corrigeant une ligne");
    await expect(sheet.getByRole("button", { name: "Appliquer au passé" })).toBeVisible();
    await expect(sheet.getByRole("checkbox", { name: "Les reclasser aussi" })).toBeVisible();
  });
});

test.describe("RuleProposal", () => {
  test("offers the line's words and the lines already there, and makes the rule", async ({
    page,
  }) => {
    await page.goto(story("ruleproposal", "default"));

    const dialog = page.getByRole("dialog", { name: "Make it a rule?" });

    await expect(dialog.getByRole("textbox", { name: "Label contains" })).toHaveValue(
      "GREENMARKET",
    );
    await expect(
      dialog.getByRole("checkbox", { name: "Also apply to the 12 lines already there" }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Create the rule" }).click();
    await expect(page.getByTestId("answer")).toHaveText(
      'Made: {"words":"GREENMARKET","applyToPast":true}',
    );
  });

  test("after a merchant is chosen, it proposes a rule that sets that merchant", async ({
    page,
  }) => {
    await page.goto(story("ruleproposal", "merchant"));

    const dialog = page.getByRole("dialog", { name: "Make it a rule?" });

    await expect(dialog).toContainText(
      "Lines whose label contains these words will have Pixelplay as their merchant when they are imported.",
    );
    await expect(dialog.getByRole("textbox", { name: "Label contains" })).toHaveValue(
      "PAYPAL *PIXELPLAY",
    );
    await dialog.getByRole("button", { name: "Create the rule" }).click();
    await expect(page.getByTestId("answer")).toHaveText(
      'Made: {"words":"PAYPAL *PIXELPLAY","applyToPast":true}',
    );
  });

  test("Cancel makes nothing", async ({ page }) => {
    await page.goto(story("ruleproposal", "default"));
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("answer")).toHaveText("No rule made");
  });

  test("with no other line, nothing to apply to the past", async ({ page }) => {
    await page.goto(story("ruleproposal", "no-other-line"));
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("it grows in in 200 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("ruleproposal", "default"));

    const dialog = page.getByRole("dialog", { name: "Make it a rule?" });

    await expect(dialog).toHaveCSS("transition-duration", "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog).toHaveCSS("transition-duration", "0s");
  });
});
