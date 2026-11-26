import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// Maybe a refund (#208): a line coming back that may cancel a purchase, not answered yet, is no
// income. Each component that shows it flags it, and the line's detail answers "Not a refund".

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

/** No motion of its own: no transition, no animation. */
async function staysStill(element: Locator) {
  await expect(element).toHaveCSS("transition-duration", "0s");
  await expect(element).toHaveCSS("animation-name", "none");
}

/** One frame: its time from the press, in ms, how many sections there are, the first's opacity. */
type Frame = { at: number; count: number; opacity: string };

/**
 * Samples the "Maybe a refund" section at every frame for `forMs` from the press on `trigger`: the
 * story answers a second after the press, then draws the line without it.
 */
async function sectionFrames(page: Page, trigger: Locator, forMs = 1600) {
  const frames = page.evaluate(
    ({ duration, sections, proposal }) => {
      // Runs in the page: everything it needs is in its arguments.
      const read = () => {
        const found = [...document.querySelectorAll(sections)].filter(
          (element) => element.querySelector(proposal) !== null,
        );

        const [first] = found;

        return {
          count: found.length,
          opacity: first === undefined ? "none" : getComputedStyle(first).opacity,
        };
      };

      return new Promise<Array<Frame>>((resolve) => {
        const seen: Array<Frame> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const at = performance.now() - start;

              seen.push({ at, ...read() });

              if (at < duration) {
                requestAnimationFrame(sample);
              } else {
                resolve(seen);
              }
            };

            requestAnimationFrame(sample);
          },
          { once: true, capture: true },
        );
      });
    },
    {
      duration: forMs,
      sections: '[data-slot="line-expense"] section',
      proposal: '[data-slot="refund-proposal"]',
    },
  );

  await trigger.click();

  return frames;
}

test.describe("LineExpense, maybe a refund", () => {
  test("says the line is not counted as received until answered, beside both answers", async ({
    page,
  }) => {
    await page.goto(story("operations-lineexpense--maybe-refund"));

    const section = page.getByRole("region", { name: "Maybe a refund" });

    await expect(section).toContainText("Until you answer, it is not counted as received.");
    await expect(section.getByRole("button", { name: "Link as a refund" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Not a refund" })).toBeVisible();
  });

  test("a line a rule classified keeps its proposals, without the waiting sentence", async ({
    page,
  }) => {
    await page.goto(story("operations-lineexpense--proposed"));

    const section = page.getByRole("region", { name: "Maybe a refund" });

    await expect(section).toBeVisible();
    await expect(section).not.toContainText("Until you answer");
  });

  test("Not a refund answers at once, with no question, and the section goes", async ({ page }) => {
    await page.goto(story("operations-lineexpense--maybe-refund"));
    await page.getByRole("button", { name: "Not a refund" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Maybe a refund" })).toHaveCount(0);
  });

  test("the section goes at once once answered, never fading", async ({ page }) => {
    await page.goto(story("operations-lineexpense--maybe-refund"));

    const frames = await sectionFrames(page, page.getByRole("button", { name: "Not a refund" }));
    const present = frames.filter((frame) => frame.count === 1);

    // There while the answer is on its way (a second), gone after it.
    expect(present.length).toBeGreaterThan(0);
    expect(frames.at(-1)?.count).toBe(0);
    expect(frames.some((frame) => Number(frame.opacity) > 0 && Number(frame.opacity) < 1)).toBe(
      false,
    );
  });

  test("the same under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("operations-lineexpense--maybe-refund"));

    const frames = await sectionFrames(page, page.getByRole("button", { name: "Not a refund" }));

    expect(frames.at(-1)?.count).toBe(0);
    expect(frames.some((frame) => Number(frame.opacity) > 0 && Number(frame.opacity) < 1)).toBe(
      false,
    );
  });

  test("Not a refund's colour moves in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("operations-lineexpense--maybe-refund"));

    const button = page.getByRole("button", { name: "Not a refund" });

    await expect(button).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(button).toHaveCSS("transition-duration", "0s");
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("operations-lineexpense--maybe-refund-french"));

    const section = page.getByRole("region", { name: "Peut-être un remboursement" });

    await expect(section).toContainText(
      "Tant que vous n'avez pas répondu, elle ne compte pas dans les reçus.",
    );
    await expect(section.getByRole("button", { name: "Pas un remboursement" })).toBeVisible();
  });
});

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

test.describe("OperationsList, maybe a refund", () => {
  test("flags the row and leaves its category out", async ({ page }) => {
    await page.goto(story("operations-operationslist--maybe-refund"));

    const chip = page.locator('[data-slot="maybe-refund"]');
    const flagged = rows(page).filter({ has: chip });

    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText("CARD PIXELPLAY STORE");
    await expect(flagged).toContainText("Maybe a refund");
    await expect(flagged).not.toContainText("Other");

    // The purchase keeps its category (in the page, shown from a laptop's width).
    const purchase = rows(page)
      .filter({ hasNot: chip })
      .filter({ hasText: "CARD PIXELPLAY STORE" });

    await expect(purchase).toContainText("Leisure › Games");
  });

  test("the chip has no motion of its own", async ({ page }) => {
    await page.goto(story("operations-operationslist--maybe-refund"));
    await staysStill(page.locator('[data-slot="maybe-refund"] > span').first());
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("operations-operationslist--maybe-refund-french"));
    await expect(page.locator('[data-slot="maybe-refund"]').first()).toHaveText(
      "Peut-être un remboursement",
    );
  });
});

test.describe("MonthBar, maybe a refund", () => {
  test("says apart, under what was received, how much may be refunds and how many lines", async ({
    page,
  }) => {
    await page.goto(story("money-month-bar--maybe-refunds"));
    await expect(page.locator('[data-slot="month-bar-maybe-refunds"]')).toHaveText(
      "Not in received: €30 that may be a refund (1 line)",
    );
  });

  test("says nothing with none", async ({ page }) => {
    await page.goto(story("money-month-bar--read-only"));
    await expect(page.locator('[data-slot="month-bar"]')).toBeVisible();
    await expect(page.locator('[data-slot="month-bar-maybe-refunds"]')).toHaveCount(0);
  });

  test("the line has no motion of its own", async ({ page }) => {
    await page.goto(story("money-month-bar--maybe-refunds"));
    await staysStill(page.locator('[data-slot="month-bar-maybe-refunds"]'));
  });

  test("writes French, several lines", async ({ page }) => {
    await page.goto(story("money-month-bar--maybe-refunds-french"));

    const line = page.locator('[data-slot="month-bar-maybe-refunds"]');

    await expect(line).toContainText("Hors reçus");
    await expect(line).toContainText("qui sont peut-être des remboursements (2 lignes)");
  });
});

test.describe("MovementList, maybe a refund", () => {
  test("flags the money back that may be a refund", async ({ page }) => {
    await page.goto(story("money-movement-list--maybe-refund"));

    const flagged = page
      .getByRole("list", { name: "Movements between your accounts" })
      .getByRole("listitem")
      .filter({ has: page.locator('[data-slot="maybe-refund"]') });

    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText("PixelPlay");
    await expect(flagged).toContainText("Maybe a refund");
  });

  test("the chip has no motion of its own", async ({ page }) => {
    await page.goto(story("money-movement-list--maybe-refund"));
    await staysStill(page.locator('[data-slot="maybe-refund"] > span'));
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("money-movement-list--maybe-refund-french"));
    await expect(page.locator('[data-slot="maybe-refund"]')).toHaveText(
      "Peut-être un remboursement",
    );
  });
});

test.describe("ReviewLines, maybe a refund", () => {
  test("flags the line, its label as its title", async ({ page }) => {
    await page.goto(story("money-review-lines--maybe-refund"));

    const flagged = page
      .locator('[data-slot="review-line"]')
      .filter({ has: page.locator('[data-slot="maybe-refund"]') });

    await expect(flagged).toHaveCount(1);
    await expect(flagged).toContainText("CARD PIXELPLAY STORE");
    await expect(flagged.locator('[data-slot="maybe-refund"]')).toBeVisible();
  });

  test("the chip shows on a phone too", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(story("money-review-lines--maybe-refund"));
    await expect(page.locator('[data-slot="maybe-refund"]')).toBeVisible();
  });

  test("the chip has no motion of its own", async ({ page }) => {
    await page.goto(story("money-review-lines--maybe-refund"));
    await staysStill(page.locator('[data-slot="maybe-refund"] > span'));
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("money-review-lines--maybe-refund-french"));
    await expect(page.locator('[data-slot="maybe-refund"]')).toHaveText(
      "Peut-être un remboursement",
    );
  });
});
