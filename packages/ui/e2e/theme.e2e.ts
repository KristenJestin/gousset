import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { themeTokens } from "../src/lib/tokens";

const THEME_TOKENS = themeTokens(
  readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8"),
);

const TOKENS = "/iframe.html?id=theme-tokens--tokens&viewMode=story";
const WITH_CHART = "/iframe.html?id=theme-colour-scheme--with-chart&viewMode=story";
const DISABLED = "/iframe.html?id=theme-colour-scheme--disabled&viewMode=story";
const MOTION = "/iframe.html?id=theme-motion--fade&viewMode=story";

/**
 * Toggles the block, which stays mounted, and reads its opacity two frames later: still on its
 * way while it animates (300 ms), already at its target when the animation is skipped.
 */
async function opacityJustAfterToggle(page: Page) {
  await page.getByRole("button", { name: "Toggle" }).click();

  return page.getByTestId("motion-sample").evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(Number(getComputedStyle(element).opacity));
          });
        });
      }),
  );
}

// One fixed day, so nothing on screen depends on when the tests run; timers still run.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-06-15T12:00:00Z"));
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

/** The colours a ui-sdk part and a Bklit chart are drawn with (lines are gradients: their stops). */
async function drawnColours(page: Page) {
  const group = page.getByRole("radiogroup", { name: "Colour scheme" });
  const chart = page.getByTestId("chart");

  return {
    picker: await group.evaluate((element) => getComputedStyle(element).backgroundColor),
    chart: await chart.evaluate((element) => [
      ...[...element.querySelectorAll("svg path, svg line")].map(
        (stroked) => getComputedStyle(stroked).stroke,
      ),
      ...[...element.querySelectorAll("svg stop")].map((stop) => getComputedStyle(stop).stopColor),
    ]),
  };
}

test("the token page shows every token in both schemes", async ({ page }) => {
  const backgrounds = new Map<string, string>();

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(TOKENS);
    await expect(page.getByRole("row")).toHaveCount(28);

    const shown = await page.locator("li code").allTextContents();

    expect(THEME_TOKENS.length).toBeGreaterThan(70);
    expect(shown.toSorted()).toEqual(THEME_TOKENS.map((token) => token.name).toSorted());

    backgrounds.set(scheme, await resolveToken(page, "--background"));

    await expect(page).toHaveScreenshot(`tokens-${scheme}.png`, { fullPage: true });
  }

  expect(backgrounds.get("light")).not.toBe(backgrounds.get("dark"));
});

test("switching the scheme changes ui-sdk's parts and Bklit's charts together, without a reload", async ({
  page,
}) => {
  // Reduced motion: the chart is drawn in its final state at once, so its screenshots never
  // catch Bklit's reveal (1.1 s) on its way. Colours are what this test is about.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto(WITH_CHART);
  await expect(page.getByTestId("chart").locator("svg path").first()).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.sameDocument = "yes";
  });

  const light = await drawnColours(page);

  expect(light.picker).toBe(await resolveToken(page, "--muted"));
  expect(light.chart).toContain(await resolveToken(page, "--chart-1"));
  await expect(page).toHaveScreenshot("scheme-light.png");

  await page.getByRole("radio", { name: "Dark" }).click();

  const html = page.locator("html");

  await expect(html).toHaveAttribute("data-color-scheme", "dark");
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(html).toHaveCSS("color-scheme", "dark");

  const dark = await drawnColours(page);

  expect(dark.picker).not.toBe(light.picker);
  expect(dark.picker).toBe(await resolveToken(page, "--muted"));
  expect(dark.chart).not.toEqual(light.chart);
  expect(dark.chart).toContain(await resolveToken(page, "--chart-1"));
  await expect(html).toHaveAttribute("data-same-document", "yes");
  await expect(page).toHaveScreenshot("scheme-dark.png");

  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).toHaveAttribute("data-color-scheme", "light");
  await expect(html).not.toHaveClass(/\bdark\b/);
  expect(await drawnColours(page)).toEqual(light);
});

test("the system's scheme is the default, and a choice is kept for the next visit", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(WITH_CHART);

  const html = page.locator("html");

  await expect(html).toHaveAttribute("data-color-scheme", "system");
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByRole("radio", { name: "System" })).toBeChecked();

  await page.getByRole("radio", { name: "Light" }).click();
  await page.reload();
  await expect(html).toHaveAttribute("data-color-scheme", "light");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
});

test("transitions run 200 ms, and are cut under reduced motion", async ({ page }) => {
  const item = page.getByRole("radio", { name: "Dark" });

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(WITH_CHART);
  await expect(item).toHaveCSS("transition-duration", "0.2s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(item).toHaveCSS("transition-duration", "0s");
});

test("Motion is cut as soon as the system asks for reduced motion, without a reload", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(MOTION);

  const block = page.getByTestId("motion-sample");

  await expect(block).toHaveCSS("opacity", "1");
  // Toward 0.25: still near 1 two frames in.
  expect(await opacityJustAfterToggle(page)).toBeGreaterThan(0.5);
  await expect(block).toHaveCSS("opacity", "0.25");

  // The same block, still mounted: toward 1, there at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await opacityJustAfterToggle(page)).toBe(1);

  // And back: toward 0.25, animated again.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await opacityJustAfterToggle(page)).toBeGreaterThan(0.5);
});

test("Motion is cut from the first render when reduced motion is already asked for", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOTION);
  await expect(page.getByTestId("motion-sample")).toHaveCSS("opacity", "1");
  expect(await opacityJustAfterToggle(page)).toBe(0.25);
});

test("a disabled picker cannot change the scheme", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(DISABLED);

    const dark = page.getByRole("radio", { name: "Dark" });

    await expect(dark).toBeDisabled();
    await dark.click({ force: true });
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "system");
    await expect(page.getByRole("radiogroup", { name: "Colour scheme" })).toHaveScreenshot(
      `picker-disabled-${scheme}.png`,
    );
  }
});
