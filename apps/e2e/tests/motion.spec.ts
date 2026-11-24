import type { Page } from "@playwright/test";

import { onPhone } from "../src/frame";
import { animationsDone, expect, test, visit } from "../src/test";

// The motion of the monthly review until it reads the user's own lines (#126, docs/design.md
// "Motion"), filmed: only the `motion-*` projects run this file, each in light or dark, on a desktop
// or a phone, every test recorded (apps/e2e/playwright.config.ts). The review's old motions (month
// change, approval, detail, chart) come back with the review in v0.4; their components keep their
// own checks in packages/ui. The pauses are for the film; the assertions say what moved.

/** Long enough for a 150 ms motion to be seen settled on the film. */
const BEAT_MS = 900;

async function beat(page: Page) {
  // A pause for the film, not a wait for a state.
  await page.waitForTimeout(BEAT_MS);
}

const translateOf = async (page: Page, name: string) =>
  page
    .getByRole("list", { name: "What works today" })
    .getByRole("link", { name: new RegExp(name) })
    .locator('[data-slot="review-coming-chevron"]')
    .evaluate((chevron) => getComputedStyle(chevron).translate);

test("the empty state comes with the page; a row's band and chevron follow the pointer", async ({
  userPage: page,
}) => {
  await visit(page, "/");

  // Nothing moves on load: no skeleton, nothing counting up.
  await expect(page.locator('[data-slot="review-coming"]')).toBeVisible();
  await animationsDone(page);
  await beat(page);

  // A phone has no pointer to hover with: the rows are pressed, not hovered.
  if (onPhone(page)) {
    return;
  }

  for (const name of ["Accounts", "Operations"]) {
    await page
      .getByRole("list", { name: "What works today" })
      .getByRole("link", { name: new RegExp(name) })
      .hover();
    await expect.poll(() => translateOf(page, name)).toMatch(/^2px/);
    await beat(page);
  }

  await page.mouse.move(0, 0);
  await expect.poll(() => translateOf(page, "Operations")).not.toMatch(/^2px/);
  await beat(page);
});
