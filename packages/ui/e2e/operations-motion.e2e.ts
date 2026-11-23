import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=operations-${component}--${name}&viewMode=story`;

/**
 * What to read at each frame, on the elements `selector` matches whose text holds `text`: the
 * first one's computed opacity or transform ("none" when there is none).
 */
type Reading = { selector: string; text: string; read: "opacity" | "transform" };

/** One frame: its time from the start, in ms, and each reading's value, in order. */
type Frame = { at: number; values: Array<string> };

/**
 * Samples `readings` at every frame for `forMs`, from the press on `trigger` or, without one, from
 * a scroll of the list by `scrollBy` pixels.
 */
async function sampleFrames(
  page: Page,
  readings: ReadonlyArray<Reading>,
  start: { trigger: Locator } | { scrollBy: number },
  forMs = 800,
): Promise<Array<Frame>> {
  const scrollBy = "scrollBy" in start ? start.scrollBy : null;

  const frames = page.evaluate(
    ({ wanted, duration, scroll }) => {
      // Runs in the page: everything it needs is in its arguments.
      const readAll = () =>
        wanted.map(({ selector, text, read }) => {
          const first = [...document.querySelectorAll(selector)].find((element) =>
            (element.textContent ?? "").includes(text),
          );

          if (first === undefined) {
            return "none";
          }

          const style = getComputedStyle(first);

          return read === "opacity" ? style.opacity : style.transform;
        });

      return new Promise<Array<Frame>>((resolve) => {
        const seen: Array<Frame> = [];

        const run = () => {
          const begin = performance.now();

          const sample = () => {
            const at = performance.now() - begin;

            seen.push({ at, values: readAll() });

            if (at < duration) {
              requestAnimationFrame(sample);
            } else {
              resolve(seen);
            }
          };

          requestAnimationFrame(sample);
        };

        if (scroll === null) {
          document.addEventListener("pointerdown", run, { once: true, capture: true });
        } else {
          document.querySelector('[data-slot="operations-scroller"]')?.scrollBy({ top: scroll });
          run();
        }
      });
    },
    { wanted: readings, duration: forMs, scroll: scrollBy },
  );

  if ("trigger" in start) {
    await start.trigger.click();
  }

  return frames;
}

/** A transform that moves the element: anything but none or the identity. */
const moves = (transform: string | undefined) =>
  transform !== undefined && transform !== "none" && transform !== "matrix(1, 0, 0, 1, 0, 0)";

/** An opacity on its way: neither hidden nor whole. */
const fading = (opacity: string | undefined) => {
  const value = Number(opacity);

  return value > 0 && value < 1;
};

/**
 * Under reduced motion, Motion still measures a layout change and draws the element where it was
 * for the frame of the change, then puts it in its place with no tween: at most that one frame,
 * right after the press, may carry a transform.
 */
const cutAtOnce = (moving: ReadonlyArray<number>) =>
  moving.length <= 1 && moving.every((at) => at < 60);

/** The times of the frames whose value at `index` passes `test`. */
const timesWhen = (frames: ReadonlyArray<Frame>, index: number, test: (value: string) => boolean) =>
  frames.flatMap(({ at, values }) => (test(values[index] ?? "") ? [at] : []));

const ROW = '[data-slot="operation-row"]';

test.describe("Operations list", () => {
  // Line 0 is not to review and leaves; line 3 is the first to review and slides to the top.
  const leaving = { selector: ROW, text: "CB GREENMARKET 2110" };
  const staying = { selector: ROW, text: "PAYLINK *PIXELPLAY" };

  const changing = (page: Page) =>
    sampleFrames(
      page,
      [
        { ...leaving, read: "opacity" },
        { ...staying, read: "transform" },
      ],
      { trigger: page.getByRole("button", { name: "Only lines to review" }) },
    );

  test("changing the rows, those that stay slide and the others fade, in 200 ms", async ({
    page,
  }) => {
    await page.goto(story("operationslist", "changing-rows"));
    await expect(page.locator(ROW).first()).toBeVisible();

    const frames = await changing(page);
    const sliding = timesWhen(frames, 1, moves);

    expect(timesWhen(frames, 0, fading).length).toBeGreaterThan(1);
    expect(sliding.length).toBeGreaterThan(1);
    expect(Math.max(...sliding)).toBeLessThan(450);
    expect(moves(frames.at(-1)?.values[1])).toBe(false);
  });

  test("under reduced motion, the rows change at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("operationslist", "changing-rows"));
    await expect(page.locator(ROW).first()).toBeVisible();

    const frames = await changing(page);

    expect(timesWhen(frames, 0, fading)).toEqual([]);
    expect(cutAtOnce(timesWhen(frames, 1, moves))).toBe(true);
  });

  test("rows a scroll brings neither fade nor slide", async ({ page }) => {
    await page.goto(story("operationslist", "ten-thousand-rows"));
    await expect(page.locator(ROW).first()).toBeVisible();

    // Two of the lines that come into view 30 rows (1,440 px) down.
    const frames = await sampleFrames(
      page,
      [
        { selector: ROW, text: "PRLV HARBOR SAVINGS", read: "opacity" },
        { selector: ROW, text: "PRLV HARBOR SAVINGS", read: "transform" },
      ],
      { scrollBy: 1440 },
      400,
    );

    expect(timesWhen(frames, 0, fading)).toEqual([]);
    expect(timesWhen(frames, 1, moves)).toEqual([]);
    // A few dozen rows in the page out of ten thousand.
    expect(await page.locator(ROW).count()).toBeLessThan(60);
  });

  test("a new search as long as the last one asks for its next page at its end", async ({
    page,
  }) => {
    await page.goto(story("operationslist", "searching-again"));
    await expect(page.locator(ROW).first()).toBeVisible();

    const scroller = page.locator('[data-slot="operations-scroller"]');
    const asked = page.locator("output");

    const toEnd = () =>
      scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

    await expect(asked).toHaveText("Next page asked 0 times");
    await toEnd();
    await expect(asked).toHaveText("Next page asked 1 times");

    // As many rows, other lines: back to the top, then down to the end again.
    await page.getByRole("button", { name: "Search again" }).click();
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await toEnd();
    await expect(asked).toHaveText("Next page asked 2 times");
  });
});

test.describe("Line detail", () => {
  const panel = { selector: '[data-slot="line-detail"]', text: "CB GREENMARKET 2110" };

  const opening = (page: Page) =>
    sampleFrames(page, [{ ...panel, read: "transform" }], {
      trigger: page
        .locator(ROW)
        .filter({ hasText: "CB GREENMARKET 2110" })
        .first()
        .getByRole("button"),
    });

  test("the row grows into its detail in 300 ms", async ({ page }) => {
    await page.goto(story("operationslayout", "desktop"));
    await expect(page.locator(ROW).first()).toBeVisible();

    const frames = await opening(page);
    const growing = timesWhen(frames, 0, moves);

    expect(growing.length).toBeGreaterThan(1);
    expect(Math.max(...growing)).toBeGreaterThan(200);
    expect(Math.max(...growing)).toBeLessThan(550);
    expect(moves(frames.at(-1)?.values[0])).toBe(false);
    await expect(page.getByRole("region", { name: "CB GREENMARKET 2110 RIVERTON" })).toBeFocused();
  });

  test("under reduced motion, the detail is there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("operationslayout", "desktop"));
    await expect(page.locator(ROW).first()).toBeVisible();

    const frames = await opening(page);

    expect(cutAtOnce(timesWhen(frames, 0, moves))).toBe(true);
  });

  test("Escape closes it and gives the focus back to its row", async ({ page }) => {
    await page.goto(story("operationslayout", "desktop"));

    const row = page
      .locator(ROW)
      .filter({ hasText: "CB GREENMARKET 2110" })
      .first()
      .getByRole("button");

    await row.click();
    await expect(page.locator('[data-slot="line-detail"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="line-detail"]')).toHaveCount(0);
    await expect(row).toBeFocused();
  });
});
