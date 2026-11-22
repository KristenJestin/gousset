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
 * Opens a story while sampling, from the page's first frame, the reveal clip's width at every
 * frame (written on `<html data-reveal>` as `time:width;…`): a reveal of 300 ms is over before
 * a test could start looking for the clip.
 */
async function openWatchingReveal(page: Page, url: string) {
  await page.addInitScript(() => {
    const samples: Array<string> = [];

    const sample = () => {
      const rect = document.querySelector('clipPath[id^="chart-grow-clip"] rect');

      if (rect !== null) {
        // Motion sets the width as a style; a plain attribute is read the same way.
        samples.push(`${performance.now()}:${Number.parseFloat(getComputedStyle(rect).width)}`);
        document.documentElement.dataset.reveal = samples.join(";");
      }

      if (performance.now() < 10_000) {
        requestAnimationFrame(sample);
      }
    };

    requestAnimationFrame(sample);
  });
  await page.goto(url);
}

/**
 * The reveal clip's width at every frame since it appeared, as a fraction of its final width
 * (below 1 while the lines are being uncovered, 1 once they are drawn), with each sample's time
 * since the first, in ms.
 */
async function revealSamples(page: Page, figure: Locator) {
  await expect(revealClip(figure)).toHaveCount(1);
  await page.waitForTimeout(1500);

  const raw = (await page.locator("html").getAttribute("data-reveal")) ?? "";

  const samples = raw.split(";").map((pair) => {
    const [at, width] = pair.split(":");

    return { at: Number(at), width: Number(width) };
  });

  // Before its first layout the clip has no width yet, with or without motion: the reveal starts
  // at its first frame with a width.
  const drawn = samples.slice(
    Math.max(
      0,
      samples.findIndex((sample) => sample.width > 0),
    ),
  );

  const first = drawn[0]?.at ?? 0;
  const final = drawn.at(-1)?.width ?? 1;

  return drawn.map((sample) => ({ at: sample.at - first, fraction: sample.width / final }));
}

async function revealFractions(page: Page, figure: Locator) {
  return (await revealSamples(page, figure)).map((sample) => sample.fraction);
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
    // In the legend (the figures' table, closed, names them too).
    const legend = figure.getByRole("list");

    await expect(legend.getByText("October")).toBeVisible();
    await expect(legend.getByText("September")).toBeVisible();
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
    await openWatchingReveal(page, spending("default"));

    const moving = await revealFractions(page, page.getByRole("figure", { name: SPENDING }));

    expect(moving.some((fraction) => fraction < 0.95)).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spending("default"));

    const still = await revealFractions(page, page.getByRole("figure", { name: SPENDING }));

    expect(still.filter((fraction) => fraction !== 1)).toEqual([]);
  });

  test("the lines are drawn within the design's 300 ms", async ({ page }) => {
    await openWatchingReveal(page, spending("default"));

    const samples = await revealSamples(page, page.getByRole("figure", { name: SPENDING }));

    // Every frame still uncovering comes within 450 ms of the clip's first (300 ms, and a few
    // frames of slack); Bklit's own 1.1 s would leave frames far past it.
    expect(samples.some((sample) => sample.fraction < 0.95)).toBe(true);
    expect(samples.filter((sample) => sample.fraction < 0.999 && sample.at > 450)).toEqual([]);
  });

  test("its figures open as a table from the keyboard", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(spending("default"));

    const figure = page.getByRole("figure", { name: SPENDING });
    const show = figure.getByRole("button", { name: "Show the figures" });
    const table = figure.getByRole("table", { name: SPENDING });

    await expect(table).toBeHidden();
    await show.focus();
    await page.keyboard.press("Enter");
    await expect(figure.getByRole("button", { name: "Hide the figures" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Day", "October", "September"]);

    const first = DAILY_SPENDING[0];

    await expect(table.getByRole("row").nth(1)).toContainText(
      formatMoney({ minor: first?.current ?? 0, currency: "EUR" }, { locale: "en" }),
    );
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

  test("under reduced motion the bars answer the pointer at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(bars("default"));

    const figure = page.getByRole("figure", { name: BARS });

    await expect(figure.locator("rect").first()).toBeVisible();

    const start = Date.now();

    await expect(async () => {
      await hoverPlot(page, figure, 0.92);
      await expect(figure.locator('[data-slot="bar-tooltip"]')).toBeVisible({ timeout: 200 });
    }).toPass({ timeout: 5000 });
    // Bklit waits for its grow-in (1.5 s by default) before it listens.
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("its figures open as a table from the keyboard", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(bars("default"));

    const figure = page.getByRole("figure", { name: BARS });
    const table = figure.getByRole("table", { name: BARS });

    await figure.getByRole("button", { name: "Show the figures" }).focus();
    await page.keyboard.press("Enter");
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(MONTHLY_SPENDING.length + 1);

    const last = MONTHLY_SPENDING.at(-1);

    await expect(table.getByRole("row").last()).toContainText("Oct");
    await expect(table.getByRole("row").last()).toContainText(
      formatMoney(last?.spent ?? { minor: 0, currency: "EUR" }, { locale: "en" }),
    );
  });

  test("a single month is one bar", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(bars("single-month"));

    const figure = page.getByRole("figure", { name: BARS });

    // Under the bar (the figures' table, closed, names it too).
    await expect(figure.locator('span:text-is("Oct")')).toBeVisible();
    await expect(figure.getByRole("table").getByRole("row")).toHaveCount(2);
  });
});
