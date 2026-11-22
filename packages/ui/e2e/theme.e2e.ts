import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const TOKENS = "/iframe.html?id=theme-tokens--tokens&viewMode=story";
const WITH_CHART = "/iframe.html?id=theme-colour-scheme--with-chart&viewMode=story";
const DISABLED = "/iframe.html?id=theme-colour-scheme--disabled&viewMode=story";

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
    await expect(page.getByText("--money-restricted").first()).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(28);

    backgrounds.set(scheme, await resolveToken(page, "--background"));

    await expect(page).toHaveScreenshot(`tokens-${scheme}.png`, { fullPage: true });
  }

  expect(backgrounds.get("light")).not.toBe(backgrounds.get("dark"));
});

test("switching the scheme changes ui-sdk's parts and Bklit's charts together, without a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
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

test("a disabled picker cannot change the scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(DISABLED);

  const dark = page.getByRole("radio", { name: "Dark" });

  await expect(dark).toBeDisabled();
  await dark.click({ force: true });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "system");
  await expect(page.getByRole("radiogroup", { name: "Colour scheme" })).toHaveScreenshot(
    "picker-disabled.png",
  );
});
