import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=money-recurringcalendar--${name}&viewMode=story`;

const BODY = '[data-slot="recurring-calendar-body"]';

/** A day of the month's grid, by what it holds. */
const dayHolding = (page: Page, text: string) =>
  page.locator('[data-slot="recurring-day"]').filter({ hasText: text });

/**
 * Presses `trigger` and, from that press, reads the content's opacity at every frame for `forMs`
 * (the content is drawn anew on a change, so it is looked up each frame). Returns the values seen.
 */
async function opacitiesFromPress(page: Page, press: () => Promise<void>, forMs = 500) {
  const samples = page.evaluate(
    ({ selector, duration }) =>
      new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const element = document.querySelector(selector);

              seen.push(element === null ? "none" : getComputedStyle(element).opacity);

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
    { selector: BODY, duration: forMs },
  );

  await press();

  return samples;
}

const fading = (opacity: string) => Number(opacity) > 0 && Number(opacity) < 1;

test.describe("RecurringCalendar", () => {
  test("shows each payment of the month on its day, with its amount", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.getByRole("table", { name: "October 2026" })).toBeVisible();
    await expect(page.locator('[data-slot="recurring-item"]')).toHaveCount(7);
    await expect(dayHolding(page, "Glycine Homes")).toContainText("€690.00");
    await expect(dayHolding(page, "Pixelplay")).toContainText("€14.99");
    // Each mark says what it is, not by its colour alone.
    await expect(dayHolding(page, "Pocketline Mobile")).toContainText("Due");
    await expect(dayHolding(page, "Glycine Homes")).toContainText("Paid");
  });

  test("marks today", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.locator('[data-slot="recurring-day"][aria-current="date"]')).toHaveText(
      "24, Today",
    );
  });

  test("marks a price rise with what it cost before", async ({ page }) => {
    await page.goto(story("price-rise"));
    await expect(page.getByText("Price up from €8.99")).toBeVisible();
    await expect(page.locator('[data-slot="recurring-item"]')).toContainText("€9.49");
  });

  test("marks an expected payment that did not come", async ({ page }) => {
    await page.goto(story("stopped"));

    const stopped = page.locator('[data-slot="recurring-item"][data-kind="stopped"]');

    await expect(stopped).toContainText("Nimbusfold");
    await expect(stopped.getByText("Expected, did not come")).toBeVisible();
  });

  test("shows a benefit credit's last day, what is left on it and its account", async ({
    page,
  }) => {
    await page.goto(story("expiring-credit"));

    const day = dayHolding(page, "MealCard");

    await expect(day).toContainText("31");
    await expect(day).toContainText("Credit expires");
    await expect(day).toContainText("€120.00");
  });

  test("the agenda lists the days that hold something, in order", async ({ page }) => {
    await page.goto(story("default"));
    await page.getByRole("tab", { name: "Agenda" }).click();

    const days = page.locator('[data-slot="recurring-agenda"] > li');

    await expect(days).toHaveCount(7);
    await expect(days.first()).toContainText("October 5");
    await expect(days.last()).toContainText("October 31");
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("moves to the next month and back, never beyond them", async ({ page }) => {
    await page.goto(story("default"));

    const previous = page.getByRole("button", { name: "Previous month" });
    const next = page.getByRole("button", { name: "Next month" });

    await expect(previous).toBeDisabled();
    await next.click();
    await expect(page.getByRole("table", { name: "November 2026" })).toBeVisible();
    await expect(page.locator('[data-slot="recurring-item"]')).toHaveCount(5);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    await previous.click();
    await expect(page.getByRole("table", { name: "October 2026" })).toBeVisible();
    await expect(previous).toBeDisabled();
  });

  test("says when nothing recurs, in either view", async ({ page }) => {
    await page.goto(story("empty-month"));
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Nothing recurring this month.")).toBeVisible();
    await page.goto(story("empty-agenda"));
    await expect(page.getByText("Nothing recurring this month.")).toBeVisible();
  });

  test("names its marks in a legend", async ({ page }) => {
    await page.goto(story("phone"));

    const legend = page.getByRole("list", { name: "What the marks mean" });

    await expect(legend).toBeVisible();
    await expect(legend.getByRole("listitem")).toHaveText([
      "Paid",
      "Due",
      "Expected, did not come",
      "Credit expires",
      "Price rise",
    ]);
  });

  test("writes French, its week starting on Monday", async ({ page }) => {
    await page.goto(story("french"));
    await expect(page.getByRole("table", { name: "octobre 2026" })).toBeVisible();
    await expect(page.getByRole("columnheader").first()).toContainText("lundi");
    await expect(page.getByRole("tab", { name: "Mois" })).toBeVisible();
    await expect(dayHolding(page, "Streamly")).toContainText("9,49");
  });

  test("its content does not move on first paint", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.locator(BODY)).toHaveAttribute("data-entrance", "none");
    await expect(page.locator(BODY)).toHaveCSS("animation-name", "none");
  });

  test("the next month slides in from the right and fades in, in 200 ms", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.getByRole("table", { name: "October 2026" })).toBeVisible();

    const opacities = await opacitiesFromPress(page, () =>
      page.getByRole("button", { name: "Next month" }).click(),
    );

    expect(opacities.filter(fading).length).toBeGreaterThan(1);
    expect(opacities.at(-1)).toBe("1");
    await expect(page.locator(BODY)).toHaveAttribute("data-entrance", "later");
    await expect(page.locator(BODY)).toHaveCSS("animation-duration", "0.2s");
  });

  test("the other view fades in, in 200 ms", async ({ page }) => {
    await page.goto(story("default"));
    await expect(page.getByRole("table")).toBeVisible();

    const opacities = await opacitiesFromPress(page, () =>
      page.getByRole("tab", { name: "Agenda" }).click(),
    );

    expect(opacities.filter(fading).length).toBeGreaterThan(1);
    expect(opacities.at(-1)).toBe("1");
    await expect(page.locator(BODY)).toHaveAttribute("data-entrance", "view");
    await expect(page.locator(BODY)).toHaveCSS("animation-duration", "0.2s");
  });

  test("under reduced motion, a month and a view are there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("default"));
    await expect(page.getByRole("table")).toBeVisible();

    const months = await opacitiesFromPress(page, () =>
      page.getByRole("button", { name: "Next month" }).click(),
    );

    expect(months.filter(fading)).toEqual([]);
    await expect(page.locator(BODY)).toHaveCSS("animation-duration", "0s");

    const views = await opacitiesFromPress(page, () =>
      page.getByRole("tab", { name: "Agenda" }).click(),
    );

    expect(views.filter(fading)).toEqual([]);
    await expect(page.locator(BODY)).toHaveCSS("animation-duration", "0s");
  });
});
