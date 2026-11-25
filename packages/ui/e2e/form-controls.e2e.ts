import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=forms-${component}--${name}&viewMode=story`;

/** A popup's motion: 150 ms when it moves, nothing under reduced motion. */
async function expectPopupMotion(page: Page, popup: Locator) {
  await expect(popup).toHaveCSS("transition-duration", "0.15s");
  await expect(popup).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(popup).toHaveCSS("transition-duration", "0s");
}

test.describe("TextField", () => {
  test("a text field is named by its label and described by its help", async ({ page }) => {
    await page.goto(story("textfield", "with-description"));

    const input = page.getByRole("textbox", { name: "E-mail" });

    await expect(input).toHaveAccessibleDescription("Only used to sign in; never shown to anyone.");
    await input.fill("ada@example.com");
    await expect(input).toHaveValue("ada@example.com");
  });

  test("a required text field is required, and its label is exactly its words", async ({
    page,
  }) => {
    await page.goto(story("textfield", "required"));

    const input = page.getByRole("textbox", { name: "E-mail", exact: true });

    await expect(input).toHaveAttribute("required", "");
    await expect(page.getByLabel("E-mail", { exact: true })).toBeEditable();
    await expect(page.locator('[data-slot="field-label"]')).toHaveText("E-mail");
  });

  test("an error is announced: the input is invalid and the message describes it", async ({
    page,
  }) => {
    await page.goto(story("textfield", "error"));

    const input = page.getByRole("textbox", { name: "E-mail" });

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      /Enter an e-mail address like ada@example\.com\./,
    );
  });

  test("a disabled text field cannot change", async ({ page }) => {
    await page.goto(story("textfield", "disabled"));
    await expect(page.getByRole("textbox", { name: "E-mail" })).toBeDisabled();
  });

  test("the border moves in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("textfield", "empty"));

    const input = page.getByRole("textbox", { name: "E-mail" });

    await expect(input).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(input).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("Select", () => {
  for (const key of ["Enter", "Space", "ArrowDown"]) {
    test(`a select opens with ${key}`, async ({ page }) => {
      await page.goto(story("select", "default"));

      const trigger = page.getByRole("combobox", { name: "Category" });

      await trigger.focus();
      await page.keyboard.press(key);
      await expect(page.getByRole("listbox")).toBeVisible();
      await expect(page.getByRole("option", { name: "Housing" })).toBeVisible();
    });
  }

  test("a select picks with the keyboard and shows the choice", async ({ page }) => {
    await page.goto(story("select", "default"));

    const trigger = page.getByRole("combobox", { name: "Category" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("option", { name: "Housing" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(trigger).toHaveText("Groceries");
    await expect(trigger).toBeFocused();
  });

  test("a select's error is announced", async ({ page }) => {
    await page.goto(story("select", "error"));

    const trigger = page.getByRole("combobox", { name: "Category" });

    await expect(trigger).toHaveAttribute("aria-invalid", "true");
    await expect(trigger).toHaveAccessibleDescription("Choose a category for this expense.");
  });

  test("a disabled select cannot open", async ({ page }) => {
    await page.goto(story("select", "disabled"));

    const trigger = page.getByRole("combobox", { name: "Category" });

    await expect(trigger).toBeDisabled();
    await expect(trigger).toHaveText("Housing");
  });

  test("the select's list fades in, and not under reduced motion", async ({ page }) => {
    await page.goto(story("select", "default"));
    await page.getByRole("combobox", { name: "Category" }).click();
    await expectPopupMotion(page, page.locator('[data-slot="select-content"]'));
  });
});

test.describe("Combobox", () => {
  test("a combobox filters as you type and says when nothing matches", async ({ page }) => {
    await page.goto(story("combobox", "default"));

    const input = page.getByRole("combobox", { name: "Category" });

    await input.pressSequentially("gro");
    await expect(page.getByRole("option")).toHaveText(["Groceries"]);
    await input.pressSequentially("zzz");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByText("Nothing matches this search.")).toBeVisible();
  });

  test("a combobox picks the first match with Enter", async ({ page }) => {
    await page.goto(story("combobox", "default"));

    const input = page.getByRole("combobox", { name: "Category" });

    await input.pressSequentially("tra");
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue("Transport");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("a combobox's error is announced", async ({ page }) => {
    await page.goto(story("combobox", "error"));

    const input = page.getByRole("combobox", { name: "Category" });

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Choose a category for this expense.");
  });

  test("a disabled combobox cannot change", async ({ page }) => {
    await page.goto(story("combobox", "disabled"));

    const input = page.getByRole("combobox", { name: "Category" });

    await expect(input).toBeDisabled();
    await expect(input).toHaveValue("Health");
  });

  test("the combobox's list fades in, and not under reduced motion", async ({ page }) => {
    await page.goto(story("combobox", "default"));
    await page.getByRole("combobox", { name: "Category" }).pressSequentially("h");
    await expectPopupMotion(page, page.locator('[data-slot="combobox-content"]'));
  });
});

test.describe("NameField", () => {
  test("a name field offers the names that contain the text, and a chosen one fills it", async ({
    page,
  }) => {
    await page.goto(story("namefield", "default"));

    const input = page.getByRole("combobox", { name: "Merchant" });

    await input.pressSequentially("green");
    await expect(page.getByRole("option")).toHaveText(["Greenmarket", "Greenway Bakery"]);
    await page.getByRole("option", { name: "Greenway Bakery" }).click();
    await expect(input).toHaveValue("Greenway Bakery");
  });

  test("a name no suggestion has is kept as typed", async ({ page }) => {
    await page.goto(story("namefield", "default"));

    const input = page.getByRole("combobox", { name: "Merchant" });

    await input.pressSequentially("Juniper Florist");
    await expect(page.getByRole("option")).toHaveCount(0);
    await input.press("Tab");
    await expect(input).toHaveValue("Juniper Florist");
  });

  test("a name field's error is announced", async ({ page }) => {
    await page.goto(story("namefield", "error"));

    const input = page.getByRole("combobox", { name: "Merchant" });

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription("Give the merchant a name.");
  });

  test("a disabled name field cannot change", async ({ page }) => {
    await page.goto(story("namefield", "disabled"));

    const input = page.getByRole("combobox", { name: "Merchant" });

    await expect(input).toBeDisabled();
    await expect(input).toHaveValue("Harbor Books");
  });

  test("the suggestions fade in, and not under reduced motion", async ({ page }) => {
    await page.goto(story("namefield", "default"));
    await page.getByRole("combobox", { name: "Merchant" }).pressSequentially("h");
    await expectPopupMotion(page, page.locator('[data-slot="autocomplete-content"]'));
  });
});

test.describe("Checkbox", () => {
  test("a checkbox toggles with Space and with its label", async ({ page }) => {
    await page.goto(story("checkbox", "with-description"));

    const checkbox = page.getByRole("checkbox", { name: "Count this transfer as savings" });

    await expect(checkbox).toHaveAccessibleDescription(/moves from/);
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await page.keyboard.press("Space");
    await expect(checkbox).not.toBeChecked();
    await page.getByText("Count this transfer as savings").click();
    await expect(checkbox).toBeChecked();
  });

  test("a disabled checkbox cannot change", async ({ page }) => {
    await page.goto(story("checkbox", "disabled"));

    const checkbox = page.getByRole("checkbox", { name: "Count this transfer as savings" });

    await expect(checkbox).toBeDisabled();
    await page.getByText("Count this transfer as savings").click({ force: true });
    await expect(checkbox).toBeChecked();
  });

  test("a checkbox's error is announced", async ({ page }) => {
    await page.goto(story("checkbox", "error"));

    const checkbox = page.getByRole("checkbox", { name: "I made up every figure in this file" });

    await expect(checkbox).toHaveAttribute("aria-invalid", "true");
    await expect(checkbox).toHaveAccessibleDescription("Tick this box to import the file.");
  });

  test("the check moves in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("checkbox", "checked"));

    const check = page.locator('[data-slot="checkbox-indicator"]');

    await expect(check).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(check).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("Switch", () => {
  test("a switch toggles with Space", async ({ page }) => {
    await page.goto(story("switch", "with-description"));

    const control = page.getByRole("switch", { name: "Hide amounts on screen" });

    await expect(control).toHaveAccessibleDescription(/show as dots/);
    await control.focus();
    await page.keyboard.press("Space");
    await expect(control).toBeChecked();
    await page.keyboard.press("Space");
    await expect(control).not.toBeChecked();
  });

  test("a disabled switch cannot change", async ({ page }) => {
    await page.goto(story("switch", "disabled"));

    const control = page.getByRole("switch", { name: "Hide amounts on screen" });

    await expect(control).toBeDisabled();
    await page.getByText("Hide amounts on screen").click({ force: true });
    await expect(control).toBeChecked();
  });

  test("a switch's error is announced", async ({ page }) => {
    await page.goto(story("switch", "error"));

    const control = page.getByRole("switch", { name: "Weekly summary by e-mail" });

    await expect(control).toHaveAttribute("aria-invalid", "true");
    await expect(control).toHaveAccessibleDescription(
      "Add an e-mail address to your account first.",
    );
  });

  test("the thumb slides in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("switch", "off"));

    const thumb = page.locator('[data-slot="switch-thumb"]');

    await expect(thumb).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(thumb).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("DatePicker", () => {
  test("a date picker opens and picks a day with the keyboard", async ({ page }) => {
    await page.goto(story("datepicker", "chosen"));

    const trigger = page.getByRole("button", { name: "Choose a date" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("gridcell", { name: /October 16, 2026/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Paid on" })).toHaveValue(/17/);
    await expect(page.locator('input[name="paid-on"]')).toHaveValue("2026-10-17");
  });

  test("a date picker in French writes day first and starts weeks on Monday", async ({ page }) => {
    await page.goto(story("datepicker", "french"));
    await expect(page.getByRole("textbox", { name: "Payé le" })).toHaveValue("16/10/2026");
    await page.getByRole("button", { name: "Choisir une date" }).click();
    await expect(page.getByRole("columnheader").first()).toHaveAccessibleName(/lundi/i);
  });

  test("a date picker's error is announced", async ({ page }) => {
    await page.goto(story("datepicker", "error"));

    const input = page.getByRole("textbox", { name: "Paid on" });

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(/This day is after the end of the statement\./);
  });

  test("a disabled date picker cannot change", async ({ page }) => {
    await page.goto(story("datepicker", "disabled"));
    await expect(page.getByRole("textbox", { name: "Paid on" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Choose a date" })).toBeDisabled();
  });

  test("the calendar fades in, and not under reduced motion", async ({ page }) => {
    await page.goto(story("datepicker", "chosen"));
    await page.getByRole("button", { name: "Choose a date" }).click();
    await expectPopupMotion(page, page.locator('[data-slot="date-picker-content"]'));
  });
});

test.describe("ColorSwatches", () => {
  test("a radio group of the palette, Automatic first and chosen until a colour is", async ({
    page,
  }) => {
    await page.goto(story("colorswatches", "default"));

    const group = page.getByRole("radiogroup", { name: "Colour" });

    await expect(group.getByRole("radio")).toHaveCount(13);
    await expect(group.getByRole("radio").first()).toHaveAccessibleName("Automatic");
    await expect(group.getByRole("radio", { name: "Automatic" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "Teal" })).toBeVisible();
  });

  test("a swatch is chosen with the keyboard, and Automatic gives the colour back", async ({
    page,
  }) => {
    await page.goto(story("colorswatches", "default"));

    const group = page.getByRole("radiogroup", { name: "Colour" });

    await group.getByRole("radio", { name: "Automatic" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "Red" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "Red" })).toBeFocused();
    await expect(page.getByTestId("chosen")).toHaveText("red");
    await expect(page.locator('[data-slot="avatar"]')).toHaveAttribute("data-color", "red");

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(group.getByRole("radio", { name: "Automatic" })).toBeChecked();
    await expect(page.getByTestId("chosen")).toHaveText("automatic");
  });

  test("a swatch is chosen with a click, and only the chosen one shows its check", async ({
    page,
  }) => {
    await page.goto(story("colorswatches", "chosen"));

    const group = page.getByRole("radiogroup", { name: "Colour" });

    await expect(group.getByRole("radio", { name: "Violet" })).toBeChecked();
    await group.getByRole("radio", { name: "Teal" }).click();
    await expect(page.getByTestId("chosen")).toHaveText("teal");
    await expect(group.locator("svg")).toHaveCount(1);
    await expect(group.getByRole("radio", { name: "Teal" }).locator("svg")).toHaveCount(1);
  });

  test("without the automatic choice, only the palette is offered", async ({ page }) => {
    await page.goto(story("colorswatches", "without-automatic"));

    const group = page.getByRole("radiogroup", { name: "Colour" });

    await expect(group.getByRole("radio")).toHaveCount(12);
    await expect(group.getByRole("radio", { name: "Teal" })).toBeChecked();
  });

  test("a disabled group cannot change", async ({ page }) => {
    await page.goto(story("colorswatches", "disabled"));
    await page.getByRole("radio", { name: "Red" }).click({ force: true });
    await expect(page.getByRole("radio", { name: "Amber" })).toBeChecked();
  });

  test("the colours are named in French on a French page", async ({ page }) => {
    await page.goto(story("colorswatches", "french"));

    const group = page.getByRole("radiogroup", { name: "Couleur" });

    await expect(group.getByRole("radio", { name: "Automatique" })).toBeChecked();
    await expect(group.getByRole("radio", { name: "Bleu canard" })).toBeVisible();
  });

  test("on a phone, the swatches wrap and none goes past the edge", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(story("colorswatches", "phone"));

    const group = page.getByRole("radiogroup", { name: "Colour" });
    const first = await group.getByRole("radio").first().boundingBox();
    const last = await group.getByRole("radio").last().boundingBox();

    expect(last?.y).toBeGreaterThan(first?.y ?? 0);
    expect(await group.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  });
});

/** A made-up 1×1 PNG: a file the logo field takes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.describe("LogoField", () => {
  test("a picked file shows at once from a data: preview, and Remove gives the initials back", async ({
    page,
  }) => {
    await page.goto(story("logofield", "default"));

    const field = page.getByRole("group", { name: "Logo" });
    const avatar = field.locator('[data-slot="avatar"]');

    await expect(avatar).toHaveText("CB");
    await expect(field.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(field.locator('input[type="file"]')).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp",
    );

    await field
      .locator('input[type="file"]')
      .setInputFiles({ name: "made-up-logo.png", mimeType: "image/png", buffer: TINY_PNG });
    await expect(page.getByTestId("reported")).toHaveText("made-up-logo.png, data: preview");
    await expect(avatar.locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(field.getByRole("button", { name: "Replace" })).toBeVisible();

    await field.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("reported")).toHaveText("removed");
    await expect(avatar).toHaveText("CB");
    await expect(field.getByRole("button", { name: "Choose a file" })).toBeVisible();
  });

  test("Choose a file opens the file picker", async ({ page }) => {
    await page.goto(story("logofield", "default"));

    const chooser = page.waitForEvent("filechooser");

    await page.getByRole("button", { name: "Choose a file" }).click();
    expect((await chooser).isMultiple()).toBe(false);
  });

  test("a refusal is said under the field and describes it", async ({ page }) => {
    await page.goto(story("logofield", "refused"));
    await expect(page.getByRole("group", { name: "Logo" })).toHaveAccessibleDescription(
      /This file is larger than 256 KiB\. Choose a smaller image\./,
    );
  });

  test("a disabled field cannot change", async ({ page }) => {
    await page.goto(story("logofield", "disabled"));
    await expect(page.getByRole("button", { name: "Replace" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  test("its buttons are in French on a French page", async ({ page }) => {
    await page.goto(story("logofield", "french"));
    await expect(page.getByRole("button", { name: "Remplacer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retirer" })).toBeVisible();
  });
});

test.describe("TextListField", () => {
  test("Enter in its input adds the text and never sends the form", async ({ page }) => {
    await page.goto(story("textlistfield", "default"));

    const input = page.getByRole("textbox", { name: "Labels" });

    await input.fill("  PAYLINK GREENMARKET  ");
    await input.press("Enter");
    await expect(
      page.getByRole("list", { name: "Labels" }).getByRole("listitem").last(),
    ).toHaveText("PAYLINK GREENMARKET");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();
    await expect(page.getByTestId("reported")).toHaveText(
      "CB GREENMARKET | MEALCARD GREENMARKET | PAYLINK GREENMARKET · sent 0 times",
    );
  });

  test("Add adds the text; an empty one is ignored and one already listed kept once", async ({
    page,
  }) => {
    await page.goto(story("textlistfield", "empty"));

    const input = page.getByRole("textbox", { name: "Labels" });
    const add = page.getByRole("button", { name: "Add" });

    await input.fill("   ");
    await add.click();
    await expect(page.getByRole("listitem")).toHaveCount(0);

    await input.fill("CB FUELSTOP");
    await add.click();
    await input.fill("CB FUELSTOP");
    await input.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("reported")).toHaveText("CB FUELSTOP · sent 0 times");
  });

  test("a text is removed by its labelled cross, and the keyboard goes on from the input", async ({
    page,
  }) => {
    await page.goto(story("textlistfield", "default"));
    await page.getByRole("button", { name: "Remove CB GREENMARKET" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem")).toHaveText(["MEALCARD GREENMARKET"]);
    await expect(page.getByRole("textbox", { name: "Labels" })).toBeFocused();
  });

  test("a refusal is announced: the input is invalid and the message describes it", async ({
    page,
  }) => {
    await page.goto(story("textlistfield", "refused"));

    const input = page.getByRole("textbox", { name: "Labels" });

    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(/already names Fuelstop/);
  });

  test("a disabled field cannot change", async ({ page }) => {
    await page.goto(story("textlistfield", "disabled"));
    await expect(page.getByRole("textbox", { name: "Labels" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove CB GREENMARKET" })).toBeDisabled();
  });

  test("a long text is cut in its chip, which stays inside the field", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(story("textlistfield", "long-text"));

    const chip = page.getByRole("listitem");
    const list = page.getByRole("list", { name: "Labels" });
    const chipBox = await chip.boundingBox();
    const listBox = await list.boundingBox();

    expect((chipBox?.x ?? 0) + (chipBox?.width ?? 0)).toBeLessThanOrEqual(
      (listBox?.x ?? 0) + (listBox?.width ?? 0) + 0.5,
    );
    await expect(chip.getByRole("button", { name: /^Remove PRLV SEPA/ })).toBeInViewport();
  });

  test("its words are in French on a French page", async ({ page }) => {
    await page.goto(story("textlistfield", "french"));
    await expect(page.getByRole("button", { name: "Ajouter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retirer CB GREENMARKET" })).toBeVisible();
  });
});
