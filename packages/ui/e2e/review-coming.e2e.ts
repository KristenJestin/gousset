import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The review's empty state (#126): nothing moves when it comes; on hover a row takes the muted band
 * in 150 ms and its chevron moves 2 px right; under reduced motion the band only, at once.
 */
const STORY = "/iframe.html?id=states-reviewcoming--with-data&viewMode=story";

const styleOf = async (
  locator: Locator,
  property: "translate" | "transitionDuration" | "backgroundColor",
) => locator.evaluate((element, name) => getComputedStyle(element)[name], property);

test("it comes with the page: no skeleton, nothing counting", async ({ page }) => {
  await page.goto(STORY);

  const block = page.locator('[data-slot="review-coming"]');

  await expect(block).toBeVisible();
  await expect(
    block.getByRole("heading", { name: "Your monthly review is not ready yet" }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(block.getByRole("list", { name: "What works today" }).getByRole("link")).toHaveCount(
    3,
  );
  await expect(block.locator("[data-part]")).toHaveCount(4);
});

test("a row takes the band and its chevron moves right on hover", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A phone has no pointer to hover with");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(STORY);

  const row = page.getByRole("link", { name: /Accounts/ });
  const chevron = row.locator('[data-slot="review-coming-chevron"]');
  const before = await styleOf(row, "backgroundColor");

  expect(await styleOf(row, "transitionDuration")).toBe("0.15s");
  expect(await styleOf(chevron, "transitionDuration")).toBe("0.15s");

  await row.hover();

  await expect.poll(() => styleOf(chevron, "translate")).toMatch(/^2px/);
  await expect.poll(() => styleOf(row, "backgroundColor")).not.toBe(before);
});

test("under reduced motion, the band only, at once", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A phone has no pointer to hover with");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(STORY);

  const row = page.getByRole("link", { name: /Accounts/ });
  const chevron = row.locator('[data-slot="review-coming-chevron"]');
  const before = await styleOf(row, "backgroundColor");

  expect(await styleOf(row, "transitionDuration")).toBe("0s");

  await row.hover();

  await expect.poll(() => styleOf(row, "backgroundColor")).not.toBe(before);
  expect(await styleOf(chevron, "translate")).not.toMatch(/^2px/);
});
