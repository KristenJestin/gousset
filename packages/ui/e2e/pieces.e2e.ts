import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { automaticColorOf } from "../src/lib/automatic-color";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

test.describe("ErrorState", () => {
  test("the error is announced, with a general text by default", async ({ page }) => {
    await page.goto(story("states-errorstate--default"));

    const alert = page.getByRole("alert");

    await expect(alert).toContainText("This block could not be loaded");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("Try again runs, and shows the loader while its promise runs", async ({ page }) => {
    await page.goto(story("states-errorstate--retry-then-loaded"));

    const retry = page.getByRole("button", { name: "Try again" });

    await retry.click();
    await expect(retry).toHaveAttribute("aria-busy", "true");
    await expect(retry.locator('[data-slot="loader"]')).toBeVisible();
    await expect(page.getByText("No lines this month")).toBeVisible({ timeout: 4000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("the error is said in French on a French page", async ({ page }) => {
    await page.goto(story("states-errorstate--default"));
    await page.evaluate(() => {
      document.documentElement.lang = "fr";
    });
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  });
});

test.describe("EmptyState", () => {
  test("says what is missing, and its action works", async ({ page }) => {
    await page.goto(story("states-emptystate--with-action"));
    await expect(page.getByText("No lines this month")).toBeVisible();
    await page.getByRole("button", { name: "Import statements" }).click();
    await expect(page.getByRole("status")).toHaveText("Import started");
  });

  test("compact and block take their own room", async ({ page }) => {
    await page.goto(story("states-emptystate--compact"));
    await expect(page.locator('[data-slot="state"]')).toHaveAttribute("data-size", "compact");
  });
});

test.describe("CategoryIcon", () => {
  test("is decorative beside a name, and the uncategorised form says so", async ({ page }) => {
    await page.goto(story("data-categoryicon--in-rows"));
    await expect(page.getByRole("img")).toHaveCount(1);
    await expect(page.getByRole("img", { name: "Uncategorised" })).toBeVisible();
  });

  test("draws an icon, never an emoji", async ({ page }) => {
    await page.goto(story("data-categoryicon--default"));

    const tile = page.locator('[data-slot="category-icon"]');

    await expect(tile.locator("svg")).toHaveCount(1);
    await expect(tile).toHaveText("");
  });
});

/** A palette token's colour on the page now, as the browser computes it. */
async function tokenColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");

    probe.style.color = `var(${name})`;
    document.body.append(probe);

    const color = getComputedStyle(probe).color;

    probe.remove();

    return color;
  }, token);
}

/** The background a class paints on the page now, as the browser computes it. */
async function classBackground(page: Page, className: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");

    probe.className = name;
    document.body.append(probe);

    const color = getComputedStyle(probe).backgroundColor;

    probe.remove();

    return color;
  }, className);
}

test.describe("Avatar", () => {
  test("shows the logo when it loads, hidden from screen readers", async ({ page }) => {
    await page.goto(story("data-avatar--with-logo"));

    const tile = page.locator('[data-slot="avatar"]');
    const logo = tile.locator("img");

    await expect(tile).toHaveAttribute("aria-hidden", "true");
    await expect(logo).toHaveAttribute("alt", "");
    await expect(logo).toHaveAttribute("loading", "lazy");
    await expect(logo).toBeVisible();
  });

  test("falls back to the initials when its image fails", async ({ page }) => {
    await page.goto(story("data-avatar--broken-logo"));

    const tile = page.locator('[data-slot="avatar"]');

    await expect(tile).toHaveText("F");
    await expect(tile.locator("img")).toHaveCount(0);
    await expect(tile).toHaveAttribute("data-color", automaticColorOf("Fuelstop"));
  });

  test("falls back to the initials when its image failed before hydration", async ({ page }) => {
    await page.goto(story("data-avatar--broken-before-hydration"));

    const tile = page.getByTestId("hydrated-after-failure").locator('[data-slot="avatar"]');

    await expect(tile).toHaveText("F");
    await expect(tile.locator("img")).toHaveCount(0);
  });

  test("a name keeps its automatic colour, visit after visit", async ({ page }) => {
    await page.goto(story("data-avatar--in-rows"));

    const first = page.locator('[data-slot="avatar"]').first();

    await expect(first).toHaveAttribute("data-color", automaticColorOf("Greenmarket"));
    await page.reload();
    await expect(first).toHaveAttribute("data-color", automaticColorOf("Greenmarket"));
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`a picked colour is painted as the palette's tile in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(story("data-avatar--picked-color"));

      const tile = page.locator('[data-slot="avatar"]');

      await expect(tile).toHaveText("CB");
      await expect(tile).toHaveAttribute("data-color", "violet");
      // The initials in the colour itself, on its tint: not on the colour at full strength.
      await expect(tile).toHaveCSS("color", await tokenColor(page, "--palette-violet"));
      await expect(tile).toHaveCSS(
        "background-color",
        await classBackground(page, "bg-palette-violet/15"),
      );
      await expect(tile).not.toHaveCSS(
        "background-color",
        await tokenColor(page, "--palette-violet"),
      );
    });
  }
});

// #204: the components that name a merchant draw its avatar beside the name, hidden from screen
// readers, the name alone naming the row.
test.describe("Avatars beside a name", () => {
  test("a list row's link is named by its title, its avatar before it", async ({ page }) => {
    await page.goto(story("data-list--links-with-avatars"));

    const row = page.getByRole("link", { name: /^Greenmarket 3 labels/ });

    await expect(row.locator('[data-slot="avatar"] img')).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Harbor Books/ }).locator('[data-slot="avatar"]'),
    ).toHaveAttribute("data-color", "teal");
  });

  test("a block's avatar stands before its heading, which keeps its name", async ({ page }) => {
    await page.goto(story("layout-app-shell--block-with-avatar"));

    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { level: 2, name: "Greenmarket", exact: true }) });

    await expect(section.locator('[data-slot="avatar"] img')).toBeVisible();
  });

  test("each operation row keeps room for an avatar, so that the labels line up", async ({
    page,
  }) => {
    await page.goto(story("operations-operationslist--with-avatars"));

    const slots = page.locator('[data-slot="operation-avatar"]');

    await expect(slots.first().locator('[data-slot="avatar"] img')).toBeVisible();

    // The sixth line has no merchant: its room is there, empty, as wide as the others'.
    const empty = slots.nth(5);

    await expect(empty.locator('[data-slot="avatar"]')).toHaveCount(0);
    expect(await empty.evaluate((node) => node.getBoundingClientRect().width)).toBe(
      await slots.first().evaluate((node) => node.getBoundingClientRect().width),
    );
  });

  test("a line's merchant shows its logo before its name", async ({ page }) => {
    await page.goto(story("operations-linemerchant--with-logo"));

    const said = page.locator('[data-slot="line-merchant"]');

    await expect(said).toContainText("Greenmarket");
    await expect(said.locator('[data-slot="avatar"] img')).toBeVisible();
  });

  test("a breakdown's merchants show their faces, the row of none its icon", async ({ page }) => {
    await page.goto(story("money-breakdown--merchants-with-avatars"));

    const rows = page.locator('[data-slot="breakdown"] > li');

    await expect(rows.locator('[data-slot="avatar"]')).toHaveCount(5);
    await expect(rows.last().locator('[data-slot="avatar"]')).toHaveCount(0);
    await expect(rows.last().locator("svg").first()).toBeVisible();
  });

  test("a flag about a merchant shows its face; one about an account none", async ({ page }) => {
    await page.goto(story("data-flag-list--with-avatars"));

    const flags = page.getByRole("list", { name: "Flagged" }).getByRole("listitem");

    await expect(flags.nth(0).locator('[data-slot="avatar"]')).toHaveAttribute("data-color", "red");
    await expect(flags.nth(2).locator('[data-slot="avatar"]')).toHaveCount(0);
  });

  test("the agenda shows each merchant's face, and still says each kind", async ({ page }) => {
    await page.goto(story("money-recurringcalendar--agenda-with-avatars"));

    const agenda = page.locator('[data-slot="recurring-agenda"]');
    const paid = agenda.locator('[data-slot="recurring-item"][data-kind="paid"]').first();

    await expect(paid.locator('[data-slot="avatar"]')).toBeVisible();
    await expect(paid).toContainText("Paid");
    // The expiring credit is an account's: its kind's tile, no face.
    await expect(
      agenda.locator('[data-slot="recurring-item"][data-kind="expiring"] [data-slot="avatar"]'),
    ).toHaveCount(0);
  });
});

/** The month as it is announced. */
const month = (page: Page) => page.locator('[data-slot="month-switcher"] [aria-live]');

/**
 * Presses previous and, at every frame for 500 ms, counts the labels drawn (not fully
 * transparent): returns how many frames drew two at once, as they do while they slide.
 *
 * What is drawn, not what is in the DOM: a leaving label stays in the DOM until Motion's exit
 * ends and React renders again, a frame or two later even when reduced motion skips the exit
 * (it is made transparent at once), so counting labels would measure React's scheduling, not
 * the motion.
 */
async function framesWithTwoLabels(page: Page) {
  return page.getByRole("button", { name: "Previous month", exact: true }).evaluate(
    (button) =>
      new Promise<number>((resolve) => {
        const start = performance.now();
        let frames = 0;

        const sample = () => {
          const drawn = [...document.querySelectorAll('[data-slot="month-label"]')].filter(
            (label) => Number(getComputedStyle(label).opacity) > 0,
          );

          if (drawn.length > 1) {
            frames += 1;
          }

          if (performance.now() - start < 500) {
            requestAnimationFrame(sample);
          } else {
            resolve(frames);
          }
        };

        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        requestAnimationFrame(sample);
      }),
  );
}

test.describe("MonthSwitcher", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-24T12:00:00"));
  });

  test("moves by pointer, and stops at the latest month", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    await expect(month(page)).toHaveText("October 2026");

    const previous = page.getByRole("button", { name: "Previous month", exact: true });
    const next = page.getByRole("button", { name: "Next month", exact: true });

    await previous.click();
    await expect(month(page)).toHaveText("September 2026");
    await next.click();
    await next.click();
    await expect(month(page)).toHaveText("November 2026");
    await expect(next).toBeDisabled();
  });

  test("moves by keyboard, with the arrows", async ({ page }) => {
    await page.goto(story("data-monthswitcher--january"));
    await page.getByRole("button", { name: "Previous month", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(month(page)).toHaveText("December 2025");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(month(page)).toHaveText("February 2026");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(month(page)).toHaveText("January 2026");
  });

  test("next is disabled on the current month", async ({ page }) => {
    await page.goto(story("data-monthswitcher--current-month"));
    await expect(month(page)).toHaveText("October 2026");
    await expect(page.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Previous month", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(month(page)).toHaveText("October 2026");
  });

  test("the focus stays on next when it turns disabled, and the arrows still move", async ({
    page,
  }) => {
    await page.goto(story("data-monthswitcher--default"));
    await expect(month(page)).toHaveText("October 2026");

    const next = page.getByRole("button", { name: "Next month", exact: true });

    await next.focus();
    await page.keyboard.press("Enter");
    await expect(month(page)).toHaveText("November 2026");
    await expect(next).toBeDisabled();
    await expect(next).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(month(page)).toHaveText("October 2026");
  });

  test("names the month in French on a French page", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    await page.evaluate(() => {
      document.documentElement.lang = "fr";
    });
    await expect(month(page)).toHaveText("octobre 2026");
    await expect(page.getByRole("button", { name: "Mois précédent", exact: true })).toBeVisible();
  });

  test("the label slides, and changes at once under reduced motion", async ({ page }) => {
    await page.goto(story("data-monthswitcher--default"));
    // The slide lasts 200 ms: most of its dozen frames draw both labels.
    expect(await framesWithTwoLabels(page)).toBeGreaterThan(4);
    await expect(page.locator('[data-slot="month-label"]')).toHaveCount(1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    expect(await framesWithTwoLabels(page)).toBe(0);
    await expect(month(page)).toHaveText("September 2026");
  });
});

test.describe("List", () => {
  test("its skeleton is as tall as the loaded list, and says it is loading", async ({ page }) => {
    await page.goto(story("data-list--loading-beside-loaded"));

    const loaded = await page.getByRole("list", { name: "Users" }).boundingBox();
    const skeleton = await page.locator('[data-slot="list-skeleton"]').boundingBox();

    expect(loaded?.height).toBeGreaterThan(0);
    expect(skeleton?.height).toBe(loaded?.height);
    await expect(page.getByRole("status", { name: "Loading" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("a linked row is one link, named by its title first", async ({ page }) => {
    await page.goto(story("data-list--links"));

    const list = page.getByRole("list", { name: "Merchants" });

    await expect(list.getByRole("link")).toHaveCount(3);
    await expect(list.getByRole("link", { name: /^Greenmarket 3 labels/ })).toHaveAttribute(
      "href",
      "#greenmarket",
    );
  });

  test("a linked row's background moves in 150 ms, and not under reduced motion", async ({
    page,
  }) => {
    await page.goto(story("data-list--links"));

    const link = page.getByRole("link", { name: /^Harbor Books/ });

    await expect(link).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(link).toHaveCSS("transition-duration", "0s");
  });

  test("on a phone, a row's tags and action go under its name, which stays whole", async ({
    page,
  }) => {
    // The width of the e2e harness's phone, whatever the project.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(story("data-list--phone"));

    const row = page.getByRole("listitem").filter({ hasText: "grace@example.com" });
    const name = row.getByText("Grace Example", { exact: true });
    const action = row.getByRole("button", { name: "Reset the password of Grace Example" });

    const nameBox = await name.boundingBox();
    const actionBox = await action.boundingBox();

    expect(actionBox?.y).toBeGreaterThan((nameBox?.y ?? 0) + (nameBox?.height ?? 0));
    // Not cut short: the whole name is drawn.
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});

test.describe("AccountChip", () => {
  test("shows the account's name", async ({ page }) => {
    await page.goto(story("data-accountchip--paid-with"));
    await expect(page.getByText("MealCard")).toBeVisible();
  });

  test("a removable chip is taken out by its labelled cross", async ({ page }) => {
    await page.goto(story("data-accountchip--removable"));

    const remove = page.getByRole("button", { name: "Remove Livret A" });

    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Livret A")).toHaveCount(0);
    await expect(page.locator('[data-slot="account-chip"]')).toHaveCount(2);
  });
});
