import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { formatMoney } from "../src/lib/money";
import { DAILY_SPENDING, MONTHLY_SPENDING } from "../src/stories/made-up";

const spending = (name: string) => `/iframe.html?id=charts-spending-chart--${name}&viewMode=story`;
const bars = (name: string) => `/iframe.html?id=charts-bar-chart--${name}&viewMode=story`;

const SPENDING = "Spending in October, against September";
const BARS = "Spending of the last six months";

/** Bklit's reveal: the width of the clip that uncovers the lines from left to right. */
function revealClip(figure: Locator) {
  return figure.locator('clipPath[id^="chart-grow-clip"] rect');
}

/**
 * The reveal clip's width at every frame for `forMs`, as a fraction of its final width: below 1
 * while the lines are being uncovered, 1 once they are drawn.
 */
async function revealFractions(figure: Locator, forMs: number) {
  const clip = revealClip(figure);

  await expect(clip).toHaveCount(1);

  const samples = await clip.evaluate(
    (rect, duration) =>
      new Promise<Array<number>>((resolve) => {
        const widths: Array<number> = [];
        const start = performance.now();

        const sample = () => {
          // Motion sets the width as a style; a plain attribute is read the same way.
          widths.push(Number.parseFloat(getComputedStyle(rect).width));

          if (performance.now() - start < duration) {
            requestAnimationFrame(sample);
          } else {
            resolve(widths);
          }
        };

        requestAnimationFrame(sample);
      }),
    forMs,
  );

  const final = await clip.evaluate((rect) => Number.parseFloat(getComputedStyle(rect).width));

  return samples.map((width) => width / final);
}

/** Moves the pointer over the plot, at a fraction of its width, until the tooltip shows. */
async function hoverPlot(page: Page, figure: Locator, fraction: number) {
  const plot = figure
    .locator("svg")
    .filter({ has: page.locator("g") })
    .last();

  const box = await plot.boundingBox();

  if (box === null) {
    throw new Error("The chart has no plot on screen");
  }

  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width * fraction + 2, box.y + box.height / 2);
}

test.describe("the spending chart", () => {
  test("draws the month before dashed, this month solid", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spending("default"));

    const figure = page.getByRole("figure", { name: SPENDING });
    const dashed = figure.locator('path[stroke-dasharray="5,4"]');

    await expect(dashed).toHaveCount(1);
    await expect(dashed).not.toHaveCSS("stroke-dasharray", "none");
    await expect(figure.getByText("October")).toBeVisible();
    await expect(figure.getByText("September")).toBeVisible();
  });

  test("hovering shows the crosshair and the hovered day's amounts", async ({ page }) => {
    await page.goto(spending("default"));

    const figure = page.getByRole("figure", { name: SPENDING });
    const crosshair = figure.locator('[id^="tooltip-indicator-gradient"]');
    const tooltip = figure.locator('[data-slot="spending-tooltip"]');

    await expect(revealClip(figure)).toHaveCount(1);
    await expect(crosshair).toHaveCount(0);

    for (const fraction of [0.3, 0.7]) {
      // Bklit's line chart listens to the pointer once its lines are drawn (about 1.1 s).
      await expect(async () => {
        await hoverPlot(page, figure, fraction);
        await expect(crosshair).toHaveCount(1, { timeout: 500 });
      }).toPass({ timeout: 5000 });
      await expect(tooltip).toBeVisible();

      const dayLabel = await tooltip.locator("span").first().textContent();
      const shown = DAILY_SPENDING[Number(dayLabel?.replaceAll(/\D/gu, "")) - 1];

      expect(shown?.current).not.toBeNull();
      await expect(tooltip).toContainText(
        formatMoney({ minor: shown?.current ?? 0, currency: "EUR" }, { locale: "en" }),
      );
      await expect(tooltip).toContainText(
        formatMoney({ minor: shown?.previous ?? 0, currency: "EUR" }, { locale: "en" }),
      );
    }
  });

  test("the skeleton is as tall as the chart", async ({ page }) => {
    await page.goto(spending("loading-beside-loaded"));

    const skeleton = page.getByTestId("skeleton").locator('[data-slot="spending-chart-skeleton"]');
    const loaded = page.getByRole("figure", { name: SPENDING });

    await expect(page.getByTestId("skeleton").getByRole("status")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(revealClip(loaded)).toHaveCount(1);
    expect((await skeleton.boundingBox())?.height).toBeCloseTo(
      (await loaded.boundingBox())?.height ?? 0,
      0,
    );
  });

  test("with nothing spent yet, the frame says so", async ({ page }) => {
    await page.goto(spending("empty"));

    const figure = page.getByRole("figure", { name: SPENDING });

    await expect(figure.getByText("Nothing spent yet in this period.")).toBeVisible();
    await expect(figure.locator("svg path")).toHaveCount(0);
  });

  test("a single day is drawn as a dot", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spending("first-day"));
    await expect(
      page.getByRole("figure", { name: SPENDING }).locator("svg circle").first(),
    ).toBeVisible();
  });

  test("the lines are uncovered from the left, and drawn at once under reduced motion", async ({
    page,
  }) => {
    await page.goto(spending("default"));

    const moving = await revealFractions(page.getByRole("figure", { name: SPENDING }), 600);

    expect(moving.some((fraction) => fraction < 0.95)).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spending("default"));

    const still = await revealFractions(page.getByRole("figure", { name: SPENDING }), 600);

    expect(still.filter((fraction) => fraction !== 1)).toEqual([]);
  });
});

test.describe("the bar chart", () => {
  test("hovering a bar shows the crosshair and its month's amount", async ({ page }) => {
    await page.goto(bars("default"));

    const figure = page.getByRole("figure", { name: BARS });
    const tooltip = figure.locator('[data-slot="bar-tooltip"]');

    await expect(figure.locator("rect").first()).toBeVisible();
    // Bklit's bar chart listens to the pointer once its bars have grown in (about 1.5 s).
    await expect(async () => {
      await hoverPlot(page, figure, 0.92);
      await expect(tooltip).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await expect(figure.locator('[id^="tooltip-indicator-gradient"]')).toHaveCount(1);

    const last = MONTHLY_SPENDING.at(-1);

    await expect(tooltip).toContainText("Oct");
    await expect(tooltip).toContainText(
      formatMoney(last?.spent ?? { minor: 0, currency: "EUR" }, { locale: "en" }),
    );
  });

  test("the skeleton is as tall as the chart", async ({ page }) => {
    await page.goto(bars("loading-beside-loaded"));

    const skeleton = page.getByTestId("skeleton").locator('[data-slot="bar-chart-skeleton"]');
    const loaded = page.getByRole("figure", { name: BARS });

    await expect(loaded.locator("rect").first()).toBeVisible();
    expect((await skeleton.boundingBox())?.height).toBeCloseTo(
      (await loaded.boundingBox())?.height ?? 0,
      0,
    );
  });

  test("with no month yet, the frame says so", async ({ page }) => {
    await page.goto(bars("empty"));
    await expect(
      page.getByRole("figure", { name: BARS }).getByText("Nothing spent yet in this period."),
    ).toBeVisible();
  });

  test("a single month is one bar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(bars("single-month"));
    await expect(page.getByRole("figure", { name: BARS }).getByText("Oct")).toBeVisible();
  });
});
