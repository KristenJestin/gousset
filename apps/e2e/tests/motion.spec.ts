import type { Page } from "@playwright/test";

import { block, monthSwitcher, seedReviewMonths } from "../src/review";
import { addUser, animationsDone, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// The motions of the monthly review (#32, docs/design.md "Motion"), filmed: only the `motion-*`
// projects run this file, each in light or dark, on a desktop or a phone, every test recorded
// (apps/e2e/playwright.config.ts). Each film has a user of its own, their September and October
// seeded (`seedReviewMonths`). The pauses are for the film; the assertions say what moved.

/** Long enough for a 200–300 ms motion to be seen settled on the film. */
const BEAT_MS = 900;

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

async function beat(page: Page) {
  // A pause for the film, not a wait for a state.
  await page.waitForTimeout(BEAT_MS);
}

/** A user of the film's own, their months seeded, signed in on `page` in November 2026. */
async function filmedUser(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  local: string,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));

  await seedReviewMonths(data, await data.ownerOf(person.email));
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, "2026-11-15");
}

test("changing month: bars and amounts move from one value to the next, numbers roll", async ({
  page,
  app,
  user,
}) => {
  await filmedUser(page, app, user, "lucien");
  await visit(page, "/?month=2026-10");
  await beat(page);

  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();
  await expect(monthSwitcher(page)).toContainText("September 2026");
  await expect(block(page, "The month").locator('[data-role="spent"]')).toContainText("€120");
  await beat(page);

  await monthSwitcher(page).getByRole("button", { name: "Next month" }).click();
  await expect(monthSwitcher(page)).toContainText("October 2026");
  await expect(block(page, "The month").locator('[data-role="spent"]')).toContainText("€155");
  await beat(page);
  await animationsDone(page);
});

test("opening a detail: the row becomes the panel and goes back to its place", async ({
  page,
  app,
  user,
}) => {
  await filmedUser(page, app, user, "mathilde");
  await visit(page, "/?month=2026-10");

  const spending = block(page, "Where the money goes");

  await spending.scrollIntoViewIfNeeded();
  await beat(page);

  await spending.getByRole("button", { name: /^Groceries/ }).click();
  await expect(spending.getByRole("group", { name: "Groceries" })).toBeVisible();
  await beat(page);
  await beat(page);

  await spending.getByRole("button", { name: "Close" }).click();
  await expect(spending.getByRole("group", { name: "Groceries" })).toHaveCount(0);
  await beat(page);
  await animationsDone(page);
});
