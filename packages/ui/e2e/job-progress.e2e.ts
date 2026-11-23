import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=feedback-job-progress--${name}&viewMode=story`;

const FILL = '[data-slot="job-progress-fill"]';

/**
 * Presses "Next step" twice to reach the step that counts, then once more (more of it counted),
 * sampling the bar's width at every frame for half a second from that last press. Returns the
 * distinct widths seen.
 */
async function widthsWhileAdvancing(page: Page) {
  await page.goto(story("advancing"));

  const next = page.getByRole("button", { name: "Next step" });

  await next.click();
  await next.click();
  // The second step of four, 300 of its 1,204 lines counted: settled before the press measured.
  await expect(page.locator(FILL)).toHaveAttribute("width", /^31\.2/);

  const samples = page.evaluate(
    ({ selector }) =>
      new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              seen.push(String(document.querySelector(selector)?.getAttribute("width")));

              if (performance.now() - start < 500) {
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
    { selector: FILL },
  );

  await next.click();

  return new Set(await samples);
}

test.describe("JobProgress", () => {
  test("says where the job stands, and its bar carries the value", async ({ page }) => {
    await page.goto(story("running"));

    await expect(page.locator('[data-slot="job-progress-status"]')).toHaveText("Step 2 of 4");

    const bar = page.getByRole("progressbar", { name: "Importing statement-october.ofx" });

    // Two steps of four, a quarter of the second done: 25 + 312 / 1204 × 25.
    await expect(bar).toHaveAttribute("aria-valuenow", "31");
    await expect(bar).toHaveAttribute("aria-valuetext", "Step 2 of 4");
    await expect(page.locator('li[aria-current="step"]')).toContainText(
      "Finding duplicates and transfers",
    );
    await expect(page.locator('li[aria-current="step"]')).toContainText("312 of 1,204");
  });

  test("a retry says which attempt comes next, and marks where it stopped", async ({ page }) => {
    await page.goto(story("retrying"));

    await expect(page.locator('[data-slot="job-progress-status"]')).toHaveText(
      "Retrying: attempt 2 of 3",
    );
    await expect(page.locator('li[data-state="stopped"]')).toContainText(
      "Finding duplicates and transfers",
    );
  });

  test("a failure is announced with what to do, and Try again runs", async ({ page }) => {
    await page.goto(story("failed"));

    await expect(page.locator('[data-slot="job-progress-status"]')).toHaveText(
      "Failed after 3 attempts",
    );
    await expect(page.getByRole("alert")).toContainText("Check that it is a bank statement");
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("a completed job is full, and says what it did", async ({ page }) => {
    await page.goto(story("completed"));

    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByText("1,204 lines read, 37 to review")).toBeVisible();
  });

  test("says its states and counts in French on a French page", async ({ page }) => {
    await page.goto(story("french"));

    await expect(page.locator('[data-slot="job-progress-status"]')).toHaveText("Étape 2 sur 4");
    await expect(page.locator('li[aria-current="step"]')).toContainText(/312 sur 1\s204/);
  });

  test("its bar grows to each new value over several frames", async ({ page }) => {
    // Old width, new width, and the steps between them.
    expect((await widthsWhileAdvancing(page)).size).toBeGreaterThan(3);
  });

  test("its bar jumps to each new value under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect((await widthsWhileAdvancing(page)).size).toBeLessThanOrEqual(2);
  });
});
