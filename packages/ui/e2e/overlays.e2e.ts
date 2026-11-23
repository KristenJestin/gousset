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

test.describe("Tooltip", () => {
  test("it shows on focus and on hover, and Escape hides it", async ({ page }) => {
    await page.goto(story("overlays-tooltip", "default"));

    const button = page.getByRole("button", { name: "To review" });
    const tooltip = page.getByRole("tooltip");

    await expect(button).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expect(tooltip).toHaveText("Lines you have not checked yet");
    await expect(button).toHaveAccessibleDescription("Lines you have not checked yet");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await button.blur();
    await button.hover();
    await expect(tooltip).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();
  });
});

test.describe("Tabs", () => {
  test("the arrow keys move between the tabs and show their panel", async ({ page }) => {
    await page.goto(story("navigation-tabs", "default"));

    const list = page.getByRole("tablist", { name: "Where the money goes" });

    await expect(list).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tab", { name: "Categories" })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText("Groceries");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Merchants" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel")).toContainText("Greenmarket");
    await page.getByRole("tab", { name: "Subjects" }).click();
    await expect(page.getByRole("tabpanel")).toContainText("Summer holiday");
  });

  test("a disabled tab is reached but never selected", async ({ page }) => {
    await page.goto(story("navigation-tabs", "disabled-tab"));
    await expect(page.getByRole("tablist")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    const subjects = page.getByRole("tab", { name: "Subjects" });

    await expect(subjects).toBeFocused();
    await expect(subjects).not.toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Greenmarket");
  });

  test("the selection slides to the chosen tab in 200 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("navigation-tabs", "default"));

    const indicator = page.locator('[data-slot="tabs-indicator"]');
    const merchants = page.getByRole("tab", { name: "Merchants" });

    await merchants.click();
    await expect(indicator).toHaveCSS("transition-duration", "0.2s");
    await expect
      .poll(async () => (await indicator.boundingBox())?.x)
      .toBe((await merchants.boundingBox())?.x);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(indicator).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("Menu", () => {
  test("Enter opens it, the arrows move, Enter runs the item and focus returns", async ({
    page,
  }) => {
    await page.goto(story("overlays-menu", "default"));

    const trigger = page.getByRole("button", { name: "Actions on Greenmarket" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const menu = page.getByRole("menu");

    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Split" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(page.getByText("Chosen: split")).toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("Escape closes it and focus returns to the trigger", async ({ page }) => {
    await page.goto(story("overlays-menu", "default"));

    const trigger = page.getByRole("button", { name: "Actions on Greenmarket" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the pointer opens it and runs an item", async ({ page }) => {
    await page.goto(story("overlays-menu", "default"));
    await page.getByRole("button", { name: "Actions on Greenmarket" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.getByText("Chosen: delete")).toBeVisible();
  });

  test("a disabled item does nothing", async ({ page }) => {
    await page.goto(story("overlays-menu", "default"));
    await page.getByRole("button", { name: "Actions on Greenmarket" }).click();

    const item = page.getByRole("menuitem", { name: "Mark as reviewed" });

    await expect(item).toHaveAttribute("aria-disabled", "true");
    await item.click({ force: true });
    await item.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByText("Chosen: nothing yet")).toBeVisible();
  });

  test("it opens from a Button with a label too", async ({ page }) => {
    await page.goto(story("overlays-menu", "from-a-button"));
    await page.getByRole("button", { name: "Import" }).click();
    await page.getByRole("menuitem", { name: "An OFX statement" }).click();
    await expect(page.getByText("Chosen: ofx")).toBeVisible();
  });

  test("it grows in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("overlays-menu", "default"));
    await page.getByRole("button", { name: "Actions on Greenmarket" }).click();

    const menu = page.getByRole("menu");

    await expect(menu).toBeVisible();
    expect(await transitionSeconds(menu)).toBe(0.15);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await transitionSeconds(menu)).toBe(0);
  });
});

test.describe("Popover", () => {
  test("it opens from the keyboard, Escape closes it and focus returns", async ({ page }) => {
    await page.goto(story("overlays-popover", "with-action"));

    const trigger = page.getByRole("button", { name: "About Greenmarket" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const popover = page.getByRole("dialog", { name: "Greenmarket" });

    await expect(popover).toBeVisible();
    await expect(page.getByRole("button", { name: "See every line" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the pointer opens it, and a press outside closes it", async ({ page }) => {
    await page.goto(story("overlays-popover", "default"));
    await page.getByRole("button", { name: "How is this counted?" }).click();

    const popover = page.getByRole("dialog", { name: "Left this month" });

    await expect(popover).toBeVisible();
    expect(await transitionSeconds(popover)).toBe(0.15);
    await page.mouse.click(5, 400);
    await expect(popover).toBeHidden();
  });

  test("under reduced motion it does not grow", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("overlays-popover", "default"));
    await page.getByRole("button", { name: "How is this counted?" }).click();
    expect(await transitionSeconds(page.getByRole("dialog"))).toBe(0);
  });
});

test.describe("Dialog", () => {
  test("it opens from the keyboard, traps focus, and Escape returns it", async ({ page }) => {
    await page.goto(story("overlays-dialog", "default"));

    const trigger = page.getByRole("button", { name: "Rename the account" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Rename the account" });

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/The name shows on every screen/);

    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      await expect(dialog.locator(":focus")).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the close button and an action close it", async ({ page }) => {
    await page.goto(story("overlays-dialog", "default"));

    const trigger = page.getByRole("button", { name: "Rename the account" });
    const dialog = page.getByRole("dialog");

    await trigger.click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("it opens from code, and a press outside closes it", async ({ page }) => {
    await page.goto(story("overlays-dialog", "open-from-code"));
    await page.getByRole("button", { name: "Open from code" }).click();
    await expect(page.getByRole("dialog", { name: "Statement imported" })).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Closed")).toBeVisible();
  });

  test("it grows in 200 ms with its backdrop, and not under reduced motion", async ({ page }) => {
    await page.goto(story("overlays-dialog", "default"));
    await page.getByRole("button", { name: "Rename the account" }).click();

    const dialog = page.getByRole("dialog");
    const backdrop = page.locator('[data-slot="dialog-backdrop"]');

    await expect(dialog).toBeVisible();
    expect(await transitionSeconds(dialog)).toBe(0.2);
    expect(await transitionSeconds(backdrop)).toBe(0.2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await transitionSeconds(dialog)).toBe(0);
    expect(await transitionSeconds(backdrop)).toBe(0);
  });

  test("a form dialog stays open on a refusal, and closes once accepted, focus back on its button", async ({
    page,
  }) => {
    await page.goto(story("overlays-dialog", "with-form"));

    const trigger = page.getByRole("button", { name: "Note a balance" });
    const dialog = page.getByRole("dialog", { name: "Note a balance" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    // Its actions: Cancel, then the submit button, last.
    await expect(dialog.getByRole("button", { name: /^(Cancel|Note it)$/ })).toHaveText([
      "Cancel",
      "Note it",
    ]);

    // Enter in the field sends the form; the refusal shows under it, the dialog stays.
    const balance = dialog.getByLabel("Balance");

    await balance.focus();
    await page.keyboard.press("Enter");
    await expect(balance).toHaveAttribute("aria-invalid", "true");
    await expect(dialog).toBeVisible();

    // Typing takes the refusal away.
    await page.keyboard.type("1,234.56");
    await expect(balance).not.toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Note it" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText("Noted", { exact: true })).toBeVisible();

    // Cancel sends nothing.
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("on a phone it is a sheet along the bottom edge; centred on a wide screen", async ({
    page,
  }) => {
    await page.goto(story("overlays-dialog", "with-form"));
    await page.getByRole("button", { name: "Note a balance" }).click();

    const dialog = page.getByRole("dialog", { name: "Note a balance" });
    const viewport = page.viewportSize();
    const width = viewport?.width ?? 0;
    const height = viewport?.height ?? 0;

    await expect(dialog).toBeVisible();

    // Once it has come to rest.
    await expect.poll(async () => page.evaluate(() => document.getAnimations().length)).toBe(0);

    const box = await dialog.boundingBox();

    if (width < 768) {
      expect(box?.x).toBe(0);
      expect(Math.round(box?.width ?? 0)).toBe(width);
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(height);
      await expect(dialog).toHaveCSS("border-bottom-left-radius", "0px");
      expect(await transitionSeconds(dialog)).toBe(0.2);
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await transitionSeconds(dialog)).toBe(0);
    } else {
      // Centred, with room around it.
      expect(Math.round((box?.x ?? 0) * 2 + (box?.width ?? 0))).toBe(width);
      expect(box?.width ?? 0).toBeLessThan(width);
    }
  });

  test("a confirmation starts on Cancel, ignores a press outside, and runs its answer", async ({
    page,
  }) => {
    await page.goto(story("overlays-dialog", "confirmation"));
    await page.getByRole("button", { name: "Delete the rule" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Delete this rule?" });

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();
    // While its answer runs, the button is busy, refuses presses and shows the loader.
    const confirm = dialog.getByRole("button", { name: "Delete" });

    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm.locator('[data-slot="loader"]')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Deleted")).toBeVisible();
  });
});

test.describe("Sheet", () => {
  test("it comes from the right on a wide screen, from the bottom on a phone", async ({ page }) => {
    await page.goto(story("overlays-sheet", "default"));
    await page.getByRole("button", { name: "Filters" }).click();

    const sheet = page.getByRole("dialog", { name: "Filters" });

    await expect(sheet).toBeVisible();

    const viewport = page.viewportSize();
    const wide = (viewport?.width ?? 0) >= 768;

    await expect(sheet).toHaveAttribute("data-side", wide ? "right" : "bottom");
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();

        return wide
          ? Math.round((box?.x ?? 0) + (box?.width ?? 0))
          : Math.round((box?.y ?? 0) + (box?.height ?? 0));
      })
      .toBe(wide ? viewport?.width : viewport?.height);
  });

  test("it traps focus, Escape closes it and focus returns", async ({ page }) => {
    await page.goto(story("overlays-sheet", "default"));

    const trigger = page.getByRole("button", { name: "Filters" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const sheet = page.getByRole("dialog", { name: "Filters" });

    await expect(sheet).toBeVisible();

    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      await expect(sheet.locator(":focus")).toHaveCount(1);
    }

    // On the close button, a first Escape would only close its tooltip.
    await sheet.getByRole("button", { name: "Show the lines" }).focus();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("its close button closes it", async ({ page }) => {
    await page.goto(story("overlays-sheet", "default"));
    await page.getByRole("button", { name: "Filters" }).click();

    const sheet = page.getByRole("dialog", { name: "Filters" });

    // Pressed once the sheet has come to rest, as a finger would: on a phone, clicking it while
    // it still rises makes Playwright scroll the sheet's own scroller, which drags it away.
    await expect
      .poll(async () => {
        const box = await sheet.boundingBox();

        return Math.round((box?.y ?? 0) + (box?.height ?? 0));
      })
      .toBe(page.viewportSize()?.height);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a form sheet stays open on a refusal, and closes once accepted, focus back on its button", async ({
    page,
  }) => {
    await page.goto(story("overlays-sheet", "with-form"));

    const trigger = page.getByRole("button", { name: "New account" });
    const sheet = page.getByRole("dialog", { name: "New account" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    // Its actions: Cancel, then the submit button, last.
    await expect(sheet.getByRole("button", { name: /^(Cancel|Create the account)$/ })).toHaveText([
      "Cancel",
      "Create the account",
    ]);

    // Enter in the field sends the form; the refusal shows under it, the sheet stays.
    const name = sheet.getByLabel("Name");

    await name.focus();
    await page.keyboard.press("Enter");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(sheet).toBeVisible();

    // Typing takes the refusal away.
    await page.keyboard.type("Joint account");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.getByText("Created", { exact: true })).toBeVisible();

    // Cancel sends nothing.
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("it slides in, and only fades under reduced motion", async ({ page, hasTouch }) => {
    const positions = async () => {
      await page.goto(story("overlays-sheet", "default"));

      const trigger = page.getByRole("button", { name: "Filters" });

      await expect(trigger).toBeVisible();

      // Samples the sheet's place at every frame for 400 ms from the press.
      const sampled = page.evaluate(
        () =>
          new Promise<Array<number>>((resolve) => {
            const seen: Array<number> = [];
            const start = performance.now();

            const sample = () => {
              const sheet = document.querySelector('[data-slot="drawer-content"]');

              if (sheet !== null) {
                const box = sheet.getBoundingClientRect();

                seen.push(Math.round(box.x + box.y));
              }

              if (performance.now() - start < 400) {
                requestAnimationFrame(sample);
              } else {
                resolve(seen);
              }
            };

            requestAnimationFrame(sample);
          }),
      );

      await trigger.click();

      return new Set(await sampled).size;
    };

    expect(await positions()).toBeGreaterThan(2);

    // On a touch screen ui-sdk moves a bottom sheet with the browser's own scroll snapping,
    // which still scrolls it into place under reduced motion: only the pointer driver fades.
    test.skip(hasTouch, "ui-sdk's scroll-snap driver scrolls the sheet in under reduced motion");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await positions()).toBe(1);
  });
});
