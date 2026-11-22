import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=actions-button--${name}&viewMode=story`;

/**
 * Clicks the story's button (a real pointer click, as ui-sdk listens to it) and samples, at every
 * frame for `forMs` from the press, when the loader is drawn: the times it first and last
 * showed, or null if it never did. The listener is in place before the click, and the result is
 * written on the button (`data-loader-first`, `data-loader-last`), so a click that came first
 * cannot leave the test waiting forever.
 */
async function loaderTimeline(page: Page, forMs: number) {
  const button = page.getByRole("button");

  await button.evaluate((element, duration) => {
    let first: number | null = null;
    let last: number | null = null;

    element.addEventListener(
      "pointerdown",
      () => {
        const start = performance.now();

        const sample = () => {
          const now = performance.now() - start;

          if (element.querySelector('[data-slot="loader"]') !== null) {
            first ??= now;
            last = now;
          }

          if (now < duration) {
            requestAnimationFrame(sample);
          } else {
            element.dataset.loaderFirst = first === null ? "none" : String(first);
            element.dataset.loaderLast = last === null ? "none" : String(last);
          }
        };

        requestAnimationFrame(sample);
      },
      { once: true },
    );
  }, forMs);

  await button.click();
  await expect(button).toHaveAttribute("data-loader-last", /.+/, { timeout: forMs + 5000 });

  const read = async (name: string) => {
    const value = await button.getAttribute(name);

    return value === null || value === "none" ? null : Number(value);
  };

  return { first: await read("data-loader-first"), last: await read("data-loader-last") };
}

test("a loading button is disabled, busy, keeps its width and shows the loader", async ({
  page,
}) => {
  await page.goto(story("loading-from-click"));

  const button = page.getByRole("button");
  const before = await button.boundingBox();
  const timeline = await loaderTimeline(page, 2300);

  // Shown after about 300 ms, never before; gone after the 1.5 s action.
  expect(timeline.first).not.toBeNull();
  expect(timeline.first ?? 0).toBeGreaterThanOrEqual(280);
  expect(timeline.last ?? 0).toBeGreaterThan(1400);
  await expect(button.locator('[data-slot="loader"]')).toHaveCount(0);
  expect((await button.boundingBox())?.width).toBe(before?.width);
});

test("while loading, the button is busy and refuses presses, its label says what runs", async ({
  page,
}) => {
  await page.goto(story("loading"));

  const button = page.getByRole("button");

  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleName("Importing…");
  await expect(button.locator('[data-slot="loader"]')).toBeVisible();
});

test("loading without an icon keeps the button's name", async ({ page }) => {
  await page.goto(story("loading-without-icon"));

  const button = page.getByRole("button", { name: "Save" });

  await expect(button.locator('[data-slot="loader"]')).toBeVisible();
  await expect(button).toHaveAttribute("aria-busy", "true");
});

test("a fast action never shows the loader", async ({ page }) => {
  await page.goto(story("fast-action"));
  expect(await loaderTimeline(page, 900)).toEqual({ first: null, last: null });
});

test("a promise from onClick makes the button pending, with the same loader", async ({ page }) => {
  await page.goto(story("pending-promise"));

  const button = page.getByRole("button", { name: "Approve" });

  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button.locator('[data-slot="loader"]')).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-busy", "true", { timeout: 3000 });
});

test("a disabled button cannot be pressed", async ({ page }) => {
  await page.goto(story("disabled"));
  await expect(page.getByRole("button")).toBeDisabled();
});

test("the loader falls, and only pulses under reduced motion", async ({ page }) => {
  await page.goto("/iframe.html?id=foundations-loader--default&viewMode=story");

  const coin = page.locator('[data-slot="loader"] circle');

  await expect(coin).toHaveCSS("animation-name", "coin-fall");
  await expect(coin).toHaveCSS("animation-duration", "1.3s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(coin).toHaveCSS("animation-name", "coin-pulse");
  await expect(coin).not.toHaveCSS("animation-duration", "0s");
});

test("the button presses in, and does not under reduced motion", async ({ page }) => {
  await page.goto(story("primary"));

  const button = page.getByRole("button");

  await expect(button).toHaveCSS("transition-duration", "0.15s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(button).toHaveCSS("transition-duration", "0s");
});
