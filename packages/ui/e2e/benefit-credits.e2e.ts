import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=accounts-benefitcredits--${name}&viewMode=story`;

/** The September credit's bar: the second credit, whose purchase the story spends. */
const SEPTEMBER_BAR = '[data-slot="benefit-credit"]:nth-child(2) [data-slot="benefit-credit-bar"]';

/**
 * Presses the button named `trigger` and, from that press, reads the bar's `width` attribute at
 * every frame for `forMs`. Returns the values seen.
 */
async function barWidthsWhile(page: Page, trigger: string, forMs = 500) {
  const samples = page.evaluate(
    ({ selector, duration }) =>
      new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              seen.push(String(document.querySelector(selector)?.getAttribute("width")));

              if (performance.now() - start < duration) {
                requestAnimationFrame(sample);
              } else {
                resolve(seen);
              }
            };

            requestAnimationFrame(sample);
          },
          { once: true, capture: true },
        );
      }),
    { selector: SEPTEMBER_BAR, duration: forMs },
  );

  await page.getByRole("button", { name: trigger }).click();

  return samples;
}

async function heightOf(page: Page, url: string, selector: string) {
  await page.goto(url);

  const box = await page.locator(selector).first().boundingBox();

  expect(box).not.toBeNull();

  return box?.height ?? 0;
}

test.describe("BenefitCredits", () => {
  test("shows what expires when, an expired amount still counted, and each credit", async ({
    page,
  }) => {
    await page.goto(story("default"));
    await expect(page.getByText("Oldest first")).toBeVisible();
    await expect(page.locator('[data-slot="benefit-expiring"]')).toHaveCount(2);
    // In what expires when, and on the expired credit's own row.
    await expect(page.getByText("Expired on 31 Oct., still counted")).toHaveCount(2);
    await expect(page.locator('[data-slot="benefit-credit"]')).toHaveCount(3);
    await expect(page.getByText("expires 28 Feb. 2027")).toBeVisible();
    await expect(page.locator(SEPTEMBER_BAR)).toHaveAttribute("width", "60%");
  });

  test("each credit but the opening balance opens its expiry date", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.getByRole("button", { name: /^Expiry date of/ })).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Expiry date of Balance when the account was added" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Expiry date of MEALCARD CREDIT" }).first().click();
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: credit-sept");
  });

  test("without onEditExpiry, nothing to click", async ({ page }) => {
    await page.goto(story("read-only"));
    await expect(page.locator('[data-slot="benefit-credit"]')).toHaveCount(3);
    await expect(page.getByRole("button")).toHaveCount(0);
  });

  test("warns of spending beyond the credits", async ({ page }) => {
    await page.goto(story("uncovered"));
    await expect(page.getByText("€35.50 spent beyond the credits")).toBeVisible();
  });

  test("says when nothing is left", async ({ page }) => {
    await page.goto(story("empty"));
    await expect(page.getByText("Nothing left on this account's credits.")).toBeVisible();
    await expect(page.locator('[data-slot="benefit-credit"]')).toHaveCount(0);
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("french"));
    await expect(page.getByText("Ce qui expire quand")).toBeVisible();
    await expect(page.getByText("Expiré le 31 Oct., toujours compté")).toHaveCount(2);
    await expect(page.getByText("Ordre d'utilisation")).toBeVisible();
  });

  test("its skeleton has the loaded block's height", async ({ page }) => {
    const loaded = await heightOf(page, story("read-only"), '[data-slot="benefit-credits"]');
    const loading = await heightOf(page, story("loading"), '[data-slot="skeleton-frame"]');

    expect(loading).toBe(loaded);
  });

  test("a credit's bar shrinks to what is left in 200 ms", async ({ page }) => {
    await page.goto(story("spending-a-credit"));
    await expect(page.locator(SEPTEMBER_BAR)).toHaveAttribute("width", "60%");

    const widths = await barWidthsWhile(page, "Spend €100");

    // Old width, new width, and the steps between them.
    expect(new Set(widths).size).toBeGreaterThan(3);
    expect(widths.at(-1)).toBe("10%");
  });

  test("a credit's bar jumps to what is left under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("spending-a-credit"));
    await expect(page.locator(SEPTEMBER_BAR)).toHaveAttribute("width", "60%");

    const widths = await barWidthsWhile(page, "Spend €100");

    expect(new Set(widths).size).toBeLessThanOrEqual(2);
    expect(widths.at(-1)).toBe("10%");
  });

  test("its rows fade in on first paint, and not under reduced motion", async ({ page }) => {
    await page.goto(story("read-only"));

    const row = page.locator('[data-slot="benefit-credit"]').first();

    await expect(row).toHaveCSS("animation-duration", "0.2s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(row).toHaveCSS("animation-duration", "0s");
  });
});
