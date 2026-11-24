import { expect, test } from "@playwright/test";

// Who a line paid (#30) on its stories: a line paid through an intermediary asks who was really
// paid, the dialog assigns the name chosen or typed, a refusal stays in the dialog, and the row
// sits in the line's detail under its category; its words in both languages and its motion.

const story = (component: string, name: string) =>
  `/iframe.html?id=operations-${component}--${name}&viewMode=story`;

test.describe("LineMerchant", () => {
  test("a line paid through an intermediary asks who was really paid", async ({ page }) => {
    await page.goto(story("linemerchant", "asks"));

    const row = page.locator('[data-slot="line-merchant"]');

    await expect(row).toHaveAttribute("data-state", "asks");
    await expect(row).toContainText("Who was really paid?");
    await expect(row).toContainText("Paid through PayPal");
    await expect(row.getByRole("button", { name: "Choose the merchant" })).toBeVisible();
  });

  test("a direct payment shows its merchant alone", async ({ page }) => {
    await page.goto(story("linemerchant", "plain"));

    const row = page.locator('[data-slot="line-merchant"]');

    await expect(row).toContainText("Greenmarket");
    await expect(row).not.toContainText("through");
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("the dialog opens from the button, and assigns the name typed", async ({ page }) => {
    await page.goto(story("linemerchant", "asks"));
    await page.getByRole("button", { name: "Choose the merchant" }).click();

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });

    await expect(dialog).toContainText("Paid through PayPal");

    const input = dialog.getByRole("combobox", { name: "Merchant" });

    await expect(input).toHaveValue("");
    await input.pressSequentially("Arcade Corner");

    const assign = dialog.getByRole("button", { name: "Assign" });

    await assign.click();
    await expect(assign).toHaveAttribute("aria-busy", "true");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("assigned")).toHaveText("Assigned: Arcade Corner");

    const row = page.locator('[data-slot="line-merchant"]');

    await expect(row).toHaveAttribute("data-state", "known");
    await expect(row).toContainText("Arcade Corner");
    await expect(row).toContainText("through PayPal");
    await expect(row.getByRole("button", { name: "Change the merchant" })).toBeVisible();
  });

  test("by the keyboard, focus comes back to the button, now Change, once assigned", async ({
    page,
  }) => {
    await page.goto(story("linemerchant", "asks"));

    const choose = page.getByRole("button", { name: "Choose the merchant" });

    await choose.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });

    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Merchant" }).pressSequentially("Arcade Corner");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("assigned")).toHaveText("Assigned: Arcade Corner");
    await expect(page.getByRole("button", { name: "Change the merchant" })).toBeFocused();
  });

  test("typing offers the merchants, and a chosen one is assigned", async ({ page }) => {
    await page.goto(story("linemerchant", "choosing"));
    await page.getByRole("button", { name: "Change the merchant" }).click();

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });
    const input = dialog.getByRole("combobox", { name: "Merchant" });

    await expect(input).toHaveValue("Pixelplay");
    await input.fill("");
    await input.pressSequentially("gr");
    await expect(page.getByRole("option")).toHaveText(["Greenmarket", "Greenway Bakery"]);
    await page.getByRole("option", { name: "Greenway Bakery" }).click();
    await expect(input).toHaveValue("Greenway Bakery");
    await dialog.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByTestId("assigned")).toHaveText("Assigned: Greenway Bakery");
  });

  test("a refusal shows under the field, and the dialog stays open", async ({ page }) => {
    await page.goto(story("linemerchant", "refused"));
    await page.getByRole("button", { name: "Choose the merchant" }).click();

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });
    const input = dialog.getByRole("combobox", { name: "Merchant" });

    await input.pressSequentially("Pixelplay");
    await dialog.getByRole("button", { name: "Assign" }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      /The merchant could not be assigned\. Try again\./,
    );
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("assigned")).toHaveText("Nobody assigned");
  });

  test("closing the dialog changes nothing", async ({ page }) => {
    await page.goto(story("linemerchant", "assigned"));
    await page.getByRole("button", { name: "Change the merchant" }).click();

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });

    await dialog.getByRole("combobox", { name: "Merchant" }).fill("Streamly");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-slot="line-merchant"]')).toContainText("Pixelplay");
    await expect(page.getByTestId("assigned")).toHaveText("Assigned: Pixelplay");

    await page.getByRole("button", { name: "Change the merchant" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("assigned")).toHaveText("Assigned: Pixelplay");
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("linemerchant", "french"));
    await expect(page.getByText("Payé via PayPal")).toBeVisible();
    await expect(page.getByText("via PayPal", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Changer le marchand" })).toBeVisible();
    await page.getByRole("button", { name: "Choisir le marchand" }).click();
    await expect(
      page.getByRole("dialog").getByRole("combobox", { name: "Marchand" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Attribuer" })).toBeVisible();
  });

  test("the row does not move, its dialog grows in in 200 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("linemerchant", "asks"));
    await expect(page.locator('[data-slot="line-merchant"]')).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: "Choose the merchant" }).click();

    const dialog = page.getByRole("dialog", { name: "Who was paid?" });

    await expect(dialog).toHaveCSS("transition-duration", "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("LineDetail with its merchant", () => {
  test("the merchant row comes right under the category", async ({ page }) => {
    await page.goto(story("linedetail", "with-merchant"));
    await expect(
      page.locator('[data-slot="line-category"] + [data-slot="line-merchant"]'),
    ).toContainText("Who was really paid?");

    await page.goto(story("linedetail", "with-assigned-merchant"));
    await expect(page.locator('[data-slot="line-merchant"]')).toContainText("through PayPal");
  });
});
