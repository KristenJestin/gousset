import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (title: string, name: string) => `/iframe.html?id=${title}--${name}&viewMode=story`;

/** The longest transition of an element, in seconds, as the browser computes it. */
async function transitionSeconds(element: Locator) {
  const durations = await element.evaluate((node) => getComputedStyle(node).transitionDuration);

  return Math.max(...durations.split(",").map((value) => Number.parseFloat(value)));
}

/**
 * The longest transition of each part (`data-slot`) while it leaves, in seconds: read the moment
 * ui-sdk marks it `data-ending-style`, after `close` (a press, Escape) starts the exit.
 */
async function leavingSeconds(
  page: Page,
  slots: ReadonlyArray<string>,
  close: () => Promise<void>,
) {
  const watch = await page.evaluateHandle((names) => {
    const leaving = names.map(
      (name) =>
        new Promise<string>((resolve) => {
          const node = document.querySelector(`[data-slot="${name}"]`);

          if (node === null) {
            resolve("none");

            return;
          }

          const observer = new MutationObserver(() => {
            if (node.hasAttribute("data-ending-style")) {
              observer.disconnect();
              resolve(getComputedStyle(node).transitionDuration);
            }
          });

          observer.observe(node, { attributes: true, attributeFilter: ["data-ending-style"] });
        }),
    );

    return { leaving: Promise.all(leaving) };
  }, slots);

  await close();

  const durations = await watch.evaluate((held) => held.leaving);

  return durations.map((each) =>
    Math.max(...each.split(",").map((value) => Number.parseFloat(value))),
  );
}

/**
 * Where a focused field's ring reaches (its outline, outside its box by its offset and its width)
 * and the box its scrolling container clips to (its padding box), in the page's pixels.
 */
async function ringAndClip(field: Locator, scroller: string) {
  // Both read in the same frame: a sheet still moving moves them together.
  return field.evaluate((node, selector) => {
    const style = getComputedStyle(node);
    const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
    const box = node.getBoundingClientRect();
    const container = node.closest(selector);
    const area = container?.getBoundingClientRect();
    const left = (area?.left ?? 0) + (container?.clientLeft ?? 0);
    const top = (area?.top ?? 0) + (container?.clientTop ?? 0);

    return {
      ring: {
        reach,
        left: box.left - reach,
        top: box.top - reach,
        right: box.right + reach,
        bottom: box.bottom + reach,
      },
      clip: {
        left,
        top,
        right: left + (container?.clientWidth ?? 0),
        bottom: top + (container?.clientHeight ?? 0),
      },
    };
  }, scroller);
}

/**
 * The ring, 2 px wide and 2 px away, lies whole inside what clips it, the field's nearest
 * `scroller` (half a pixel of rounding).
 */
async function expectRingInside(field: Locator, scroller: string) {
  const { ring, clip } = await ringAndClip(field, scroller);

  expect(ring.reach).toBe(4);
  expect(ring.left).toBeGreaterThanOrEqual(clip.left - 0.5);
  expect(ring.top).toBeGreaterThanOrEqual(clip.top - 0.5);
  expect(ring.right).toBeLessThanOrEqual(clip.right + 0.5);
  expect(ring.bottom).toBeLessThanOrEqual(clip.bottom + 0.5);
}

/**
 * Once nothing moves on the page any more: no popup on its first frame (before its transition
 * starts), and every transition and animation ended.
 */
async function atRest(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.querySelectorAll("[data-starting-style]").length +
          document.getAnimations().length,
      ),
    )
    .toBe(0);
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

  test("it grows in 200 ms over its backdrop (rises in 300 ms on a phone), and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("overlays-dialog", "default"));
    await page.getByRole("button", { name: "Rename the account" }).click();

    const dialog = page.getByRole("dialog");
    const backdrop = page.locator('[data-slot="dialog-backdrop"]');
    const wide = (page.viewportSize()?.width ?? 0) >= 768;

    await expect(dialog).toBeVisible();
    expect(await transitionSeconds(dialog)).toBe(wide ? 0.2 : 0.3);
    expect(await transitionSeconds(backdrop)).toBe(0.2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await transitionSeconds(dialog)).toBe(0);
    expect(await transitionSeconds(backdrop)).toBe(0);
  });

  test("it leaves in 150 ms (200 ms on a phone), its backdrop fading out in 200 ms", async ({
    page,
  }) => {
    await page.goto(story("overlays-dialog", "default"));
    await page.getByRole("button", { name: "Rename the account" }).click();

    const dialog = page.getByRole("dialog");
    const wide = (page.viewportSize()?.width ?? 0) >= 768;

    await expect(dialog).toBeVisible();
    await atRest(page);

    const [content, backdrop] = await leavingSeconds(
      page,
      ["dialog-content", "dialog-backdrop"],
      async () => page.keyboard.press("Escape"),
    );

    expect(content).toBe(wide ? 0.15 : 0.2);
    expect(backdrop).toBe(0.2);
    await expect(dialog).toBeHidden();
  });

  test("its backdrop dims the page in the scrim's colour, in light and in dark", async ({
    page,
  }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(story("overlays-dialog", "default"));
      await page.getByRole("button", { name: "Rename the account" }).click();

      const backdrop = page.locator('[data-slot="dialog-backdrop"]');

      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(backdrop).toHaveCSS("background-color", await resolveToken(page, "--overlay"));
      await expect(backdrop).toHaveCSS("opacity", "1");
    }
  });

  test("a focused field's ring lies whole inside the dialog", async ({ page }) => {
    await page.goto(story("overlays-dialog", "with-form"));

    const trigger = page.getByRole("button", { name: "Note a balance" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Note a balance" });
    const balance = dialog.getByLabel("Balance");

    await expect(dialog).toBeVisible();
    await atRest(page);
    // Reading starts at the title: Tab reaches the close button, then the field.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(balance).toBeFocused();
    await expectRingInside(balance, '[data-slot="dialog-content"]');
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
      expect(await transitionSeconds(dialog)).toBe(0.3);
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

  test("it slides in, and does not move under reduced motion", async ({ page }) => {
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
              const sheet = document.querySelector('[data-slot="dialog-content"]');

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
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await positions()).toBe(1);
  });

  test("it slides in in 300 ms and out in 200 ms, over a backdrop fading in and out in 200 ms; not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("overlays-sheet", "default"));
    await page.getByRole("button", { name: "Filters" }).click();

    const sheet = page.getByRole("dialog", { name: "Filters" });
    const backdrop = page.locator('[data-slot="dialog-backdrop"]');

    await expect(sheet).toBeVisible();
    expect(await transitionSeconds(sheet)).toBe(0.3);
    expect(await transitionSeconds(backdrop)).toBe(0.2);
    await atRest(page);

    const [leaving, fading] = await leavingSeconds(
      page,
      ["dialog-content", "dialog-backdrop"],
      async () => page.keyboard.press("Escape"),
    );

    expect(leaving).toBe(0.2);
    expect(fading).toBe(0.2);
    await expect(sheet).toBeHidden();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(sheet).toBeVisible();
    expect(await transitionSeconds(sheet)).toBe(0);
    expect(await transitionSeconds(backdrop)).toBe(0);
  });

  test("a press on the backdrop closes it", async ({ page }) => {
    await page.goto(story("overlays-sheet", "default"));
    await page.getByRole("button", { name: "Filters" }).click();

    const sheet = page.getByRole("dialog", { name: "Filters" });

    await expect(sheet).toBeVisible();
    await atRest(page);
    // The top left corner: the backdrop, beside a side sheet and above a bottom one.
    await page.mouse.click(4, 4);
    await expect(sheet).toBeHidden();
  });

  test("while its form is sent, neither the backdrop, Escape, the close button nor Cancel closes it", async ({
    page,
  }) => {
    await page.goto(story("overlays-sheet", "with-form"));

    const trigger = page.getByRole("button", { name: "New account" });
    const sheet = page.getByRole("dialog", { name: "New account" });

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(sheet.getByLabel("Name")).toBeFocused();
    await atRest(page);
    await page.keyboard.type("Joint account");
    await page.keyboard.press("Enter");

    // Sent: the story's answer takes a second and a half.
    await expect(sheet.getByRole("button", { name: "Create the account" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(sheet.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(sheet.getByRole("button", { name: "Close" })).toBeDisabled();
    await page.mouse.click(4, 4);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveAttribute("data-open");
    await expect(sheet).not.toHaveAttribute("data-ending-style");
    await expect(page.getByText("Nothing created")).toBeVisible();

    // Once answered, the page closes it.
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Created", { exact: true })).toBeVisible();
  });

  test("a form sheet starts on its first field, its focus ring whole inside the scrolling body", async ({
    page,
  }) => {
    await page.goto(story("overlays-sheet", "with-form"));

    const trigger = page.getByRole("button", { name: "New account" });

    await trigger.focus();
    await page.keyboard.press("Enter");

    const sheet = page.getByRole("dialog", { name: "New account" });
    const name = sheet.getByLabel("Name");

    await expect(name).toBeFocused();
    await atRest(page);
    await expectRingInside(name, '[data-slot="sheet-body"]');

    // Every field of the body, each in its turn.
    for (const label of ["Institution", "Currency", "Opening balance"]) {
      await page.keyboard.press("Tab");

      const field = sheet.getByLabel(label);

      await expect(field).toBeFocused();
      await expectRingInside(field, '[data-slot="sheet-body"]');
    }
  });
});

/** What a token resolves to on the page now, as the browser computes a colour. */
async function resolveToken(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");

    probe.style.color = `var(${name})`;
    document.body.append(probe);

    const color = getComputedStyle(probe).color;

    probe.remove();

    return color;
  }, token);
}

test.describe("Floating surfaces", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`a menu and a select's list draw their own edge and a shadow, in ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });

      const surfaces = [
        {
          url: story("overlays-menu", "default"),
          trigger: page.getByRole("button", { name: "Actions on Greenmarket" }),
          popup: page.getByRole("menu"),
        },
        {
          url: story("forms-select", "in-a-card"),
          trigger: page.getByRole("combobox", { name: "Category" }),
          popup: page.locator('[data-slot="select-content"]'),
        },
      ];

      for (const surface of surfaces) {
        await page.goto(surface.url);
        await surface.trigger.click();
        await expect(surface.popup).toBeVisible();

        const edge = await resolveToken(page, "--popover-border");

        expect(edge).not.toBe(await resolveToken(page, "--border"));
        await expect(surface.popup).toHaveCSS("border-top-width", "1px");
        await expect(surface.popup).toHaveCSS("border-top-color", edge);
        await expect(surface.popup).not.toHaveCSS("box-shadow", "none");
      }
    });
  }
});
