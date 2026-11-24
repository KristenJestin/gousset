import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The MCP consent screen (issue #123): reference screenshots with read only asked and with read and
 * write asked, on a desktop and on a phone, light and dark; and its choices, which never wrap nor
 * overflow, in English and in French (the longest labels), down to the narrowest phone. Firefox
 * draws the same component in its own checks. Reduced motion: caught in its final state.
 *
 * The references come from CI (the `references` job of `.github/workflows/ci.yml`), never from a
 * local browser.
 */
const story = (name: string) => `/iframe.html?id=layout-consent-screen--${name}&viewMode=story`;

async function open(page: Page, name: string) {
  await page.goto(story(name));
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Every button of the screen holds its label on one line, inside its own box. */
async function expectNoButtonOverflows(page: Page) {
  const buttons = page.getByRole("button");
  const count = await buttons.count();

  expect(count).toBeGreaterThan(1);

  for (let index = 0; index < count; index += 1) {
    const sizes = await buttons
      .nth(index)
      .evaluate((button) => ({ scroll: button.scrollWidth, client: button.clientWidth }));

    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  }

  const viewport = page.viewportSize();
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);

  expect(pageWidth).toBeLessThanOrEqual(viewport?.width ?? 0);
}

/** Where a button is drawn; it must be. */
async function boxOf(page: Page, name: string | RegExp) {
  const box = await page.getByRole("button", { name }).boundingBox();

  expect(box).not.toBeNull();

  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme}`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "firefox", "A desktop and a phone, both in Chromium");
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    });

    test(`the consent screen with read and write asked, ${scheme}`, async ({ page }) => {
      await open(page, "read-and-write");

      const choices = page.getByRole("button", { name: /^Allow/ });

      await expect(choices).toHaveCount(2);
      await expect(choices.first()).toHaveAccessibleName("Allow read only Recommended");
      await expect(choices.nth(1)).toHaveAccessibleName("Allow read and write");
      await expect(page.getByRole("heading", { name: "It also asks to write" })).toBeVisible();

      await expect(page).toHaveScreenshot(`consent-read-and-write-${scheme}.png`, {
        fullPage: true,
      });
    });

    test(`the consent screen with read only asked, ${scheme}`, async ({ page }) => {
      await open(page, "read-only");

      await expect(page.getByRole("button", { name: /^Allow/ })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Allow", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "It also asks to write" })).toHaveCount(0);

      await expect(page).toHaveScreenshot(`consent-read-only-${scheme}.png`, { fullPage: true });
    });
  });
}

test.describe("the choices", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the two Allow choices are stacked at full width, read only first, Deny apart", async ({
    page,
  }) => {
    await open(page, "read-and-write");

    const readOnly = await boxOf(page, /^Allow read only/);
    const readWrite = await boxOf(page, "Allow read and write");
    const deny = await boxOf(page, "Deny");

    // One above the other, the same width, read only first.
    expect(readOnly.x).toBe(readWrite.x);
    expect(readOnly.width).toBe(readWrite.width);
    expect(readOnly.y + readOnly.height).toBeLessThan(readWrite.y);
    // Deny below them both, narrower: not a third equal choice.
    expect(readWrite.y + readWrite.height).toBeLessThan(deny.y);
    expect(deny.width).toBeLessThan(readWrite.width);
  });

  for (const name of ["read-and-write", "french"]) {
    test(`no label wraps or overflows on the narrowest phone, ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 568 });
      await open(page, name);
      await expectNoButtonOverflows(page);
    });

    test(`no label wraps or overflows on a desktop, ${name}`, async ({ page }) => {
      await open(page, name);
      await expectNoButtonOverflows(page);
    });
  }

  test("a long client name never hides where it comes from on the narrowest phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page, "long-client-name");

    // The origin's last line ends above the pinned choices.
    const origin = await page.getByText(/will be sent back to 127\.0\.0\.1:53682\./).boundingBox();
    const allow = await boxOf(page, /^Allow read only/);

    expect(origin).not.toBeNull();
    expect((origin?.y ?? Infinity) + (origin?.height ?? 0)).toBeLessThan(allow.y);
  });

  test("the pressed choice is busy and the others are disabled", async ({ page }) => {
    await open(page, "answering");

    await expect(page.getByRole("button", { name: /^Allow read only/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByRole("button", { name: "Allow read and write" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Deny" })).toBeDisabled();
  });
});
