import type { Page } from "@playwright/test";

import { onPhone } from "../src/frame";
import { animationsDone, expect, test, visit } from "../src/test";

// The four motions of the monthly review (issue #10, docs/design.md "Motion"), filmed: only the
// `motion-*` projects run this file, each in light or dark, on a desktop or a phone, every test
// recorded (apps/e2e/playwright.config.ts). The pauses are for the film, so that each motion can
// be watched to its end; the assertions say the motion happened.

/** Long enough for a 200–300 ms motion to be seen settled on the film. */
const BEAT_MS = 900;

const block = (page: Page, title: string) => page.getByRole("region", { name: title });

const monthSwitcher = (page: Page) => page.getByRole("group", { name: "Month", exact: true });

async function beat(page: Page) {
  // A pause for the film, not a wait for a state.
  await page.waitForTimeout(BEAT_MS);
}

test("changing month: bars and amounts move from one value to the next, numbers roll", async ({
  userPage: page,
}) => {
  await visit(page, "/?month=2026-10");
  await beat(page);

  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();
  await expect(monthSwitcher(page)).toContainText("September 2026");
  await beat(page);

  await monthSwitcher(page).getByRole("button", { name: "Next month" }).click();
  await expect(monthSwitcher(page)).toContainText("October 2026");
  await beat(page);
  await animationsDone(page);
});

test("validating a line to review: the row folds, the counter drops, the category's bar grows", async ({
  userPage: page,
}) => {
  // April is this film's own month: approving changes it for the rest of the run.
  await visit(page, "/?month=2026-04");

  const counter = block(page, "To review").locator('[data-slot="count"]').first();

  if (onPhone(page)) {
    await block(page, "To review")
      .getByRole("button", { name: /^To review/ })
      .click();
  } else {
    await block(page, "To review").scrollIntoViewIfNeeded();
  }

  await beat(page);

  const list = onPhone(page)
    ? page.getByRole("dialog", { name: "To review" })
    : block(page, "To review");

  for (const left of ["5", "4"]) {
    await list
      .getByRole("button", { name: /^Approve / })
      .first()
      .click();
    await expect(counter).toContainText(left);
    await beat(page);
  }

  if (onPhone(page)) {
    await page.keyboard.press("Escape");
  }

  await block(page, "Where the money goes").scrollIntoViewIfNeeded();
  await beat(page);
  await animationsDone(page);
});

test("opening a detail: the row becomes the panel and goes back to its place", async ({
  userPage: page,
}) => {
  await visit(page, "/?month=2026-10");
  await block(page, "Where the money goes").scrollIntoViewIfNeeded();
  await beat(page);

  const spending = block(page, "Where the money goes");

  await spending.getByRole("button", { name: /^Housing/ }).click();
  await expect(spending.getByRole("group", { name: "Housing" })).toBeVisible();
  await beat(page);
  await beat(page);

  await spending.getByRole("button", { name: "Close" }).click();
  await expect(spending.getByRole("group", { name: "Housing" })).toHaveCount(0);
  await beat(page);
  await animationsDone(page);
});

test("chart hover: the crosshair follows, the value slides", async ({ userPage: page }) => {
  await visit(page, "/?month=2026-10");

  const spending = block(page, "Where the money goes");

  await spending.scrollIntoViewIfNeeded();
  await spending.getByRole("button", { name: /^Groceries/ }).click();

  const chart = spending.getByRole("figure", { name: /^Groceries: spending in October/ });

  await expect(chart).toBeVisible();
  await beat(page);

  // The plot itself: the last drawing of the figure, under its legend.
  const box = await chart
    .locator("svg")
    .filter({ has: page.locator("g") })
    .last()
    .boundingBox();

  if (box === null) {
    throw new Error("The chart has no plot to hover.");
  }

  const y = box.y + box.height / 2;

  // Bklit's line chart listens to the pointer once its lines are drawn.
  await expect(async () => {
    await page.mouse.move(box.x + box.width * 0.1, y);
    await page.mouse.move(box.x + box.width * 0.1 + 2, y);
    await expect(page.locator('[data-slot="spending-tooltip"]')).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });

  for (const share of [0.3, 0.5, 0.7, 0.9, 0.4]) {
    await page.mouse.move(box.x + box.width * share, y, { steps: 20 });
    await beat(page);
  }

  await page.mouse.move(0, 0);
  await beat(page);
});
