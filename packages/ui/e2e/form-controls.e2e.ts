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

  // Issue #224: a switch a page saves says so until the save ends.
  test("a switch being saved is busy at once, keeps its value and its focus, and shows the loader after about 300 ms", async ({
    page,
  }) => {
    await page.goto(story("switch", "slow-save"));

    const control = page.getByRole("switch", { name: "Hide amounts on screen" });

    await expect(control).not.toHaveAttribute("aria-busy", "true");

    const timeline = await switchLoaderTimeline(control, 2300);

    // Busy and on during the 1.5 s save; the loader from about 300 ms, never before.
    expect(timeline.busyFirst ?? Number.NaN).toBeLessThan(200);
    expect(timeline.first).not.toBeNull();
    expect(timeline.first ?? 0).toBeGreaterThanOrEqual(280);
    expect(timeline.last ?? 0).toBeGreaterThan(1400);
    await expect(control).not.toHaveAttribute("aria-busy", "true");
    await expect(control.locator('[data-slot="loader"]')).toHaveCount(0);
    await expect(control).toBeChecked();
    await expect(control).toBeFocused();
  });

  test("a switch saved fast is busy but never shows the loader", async ({ page }) => {
    await page.goto(story("switch", "fast-save"));

    const control = page.getByRole("switch", { name: "Hide amounts on screen" });
    const timeline = await switchLoaderTimeline(control, 900);

    expect(timeline.busyFirst).not.toBeNull();
    expect({ first: timeline.first, last: timeline.last }).toEqual({ first: null, last: null });
    await expect(control).toBeChecked();
  });

  test("a pending switch stays named and focusable; its loader only pulses under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("switch", "pending"));

    const control = page.getByRole("switch", { name: "Hide amounts on screen" });
    const coin = control.locator('[data-slot="loader"] circle');

    await expect(control).toHaveAttribute("aria-busy", "true");
    await expect(control).toBeEnabled();
    await expect(control).toHaveAccessibleName("Hide amounts on screen");
    await control.focus();
    await expect(control).toBeFocused();
    await expect(coin).toHaveCSS("animation-name", "coin-fall");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(coin).toHaveCSS("animation-name", "coin-pulse");
  });
});

/**
 * Clicks the switch (a real pointer click, as ui-sdk listens to it) and samples, at every frame for
 * `forMs` from the press, when it is busy and when its loader is drawn: the times each first showed,
 * and the loader's last, or null. The listener is in place before the click, and the result is
 * written on the switch, so a click that came first cannot leave the test waiting forever.
 */
async function switchLoaderTimeline(control: Locator, forMs: number) {
  await control.evaluate((element, duration) => {
    let busyFirst: number | null = null;
    let first: number | null = null;
    let last: number | null = null;

    element.addEventListener(
      "pointerdown",
      () => {
        const start = performance.now();

        const sample = () => {
          const now = performance.now() - start;

          if (element.getAttribute("aria-busy") === "true") {
            busyFirst ??= now;
          }

          if (element.querySelector('[data-slot="loader"]') !== null) {
            first ??= now;
            last = now;
          }

          if (now < duration) {
            requestAnimationFrame(sample);
          } else {
            element.dataset.busyFirst = busyFirst === null ? "none" : String(busyFirst);
            element.dataset.loaderFirst = first === null ? "none" : String(first);
            element.dataset.loaderLast = last === null ? "none" : String(last);
          }
        };

        requestAnimationFrame(sample);
      },
      { once: true },
    );
  }, forMs);

  await control.click();
  await expect(control).toHaveAttribute("data-loader-last", /.+/, { timeout: forMs + 5000 });

  const read = async (name: string) => {
    const value = await control.getAttribute(name);

    return value === null || value === "none" ? null : Number(value);
  };

  return {
    busyFirst: await read("data-busy-first"),
    first: await read("data-loader-first"),
    last: await read("data-loader-last"),
  };
}

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
