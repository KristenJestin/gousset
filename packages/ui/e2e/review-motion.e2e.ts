import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=money-${component}--${name}&viewMode=story`;

/**
 * What to read at each frame, on the elements `selector` matches whose text holds `text`: how many
 * there are, or the first one's computed opacity or transform ("none" when there is none).
 */
type Reading = { selector: string; text: string; read: "count" | "opacity" | "transform" };

/** One frame: its time from the press, in ms, and each reading's value, in order. */
type Frame = { at: number; values: Array<string> };

/** Samples `readings` at every frame for `forMs` from the press on `trigger`, then returns them. */
async function framesFromPress(
  page: Page,
  trigger: Locator,
  readings: ReadonlyArray<Reading>,
  forMs = 800,
): Promise<Array<Frame>> {
  const frames = page.evaluate(
    ({ wanted, duration }) => {
      // Runs in the page: everything it needs is in its arguments.
      const readAll = () =>
        wanted.map(({ selector, text, read }) => {
          const found = [...document.querySelectorAll(selector)].filter((element) =>
            (element.textContent ?? "").includes(text),
          );

          const [first] = found;

          if (read === "count") {
            return String(found.length);
          }

          if (first === undefined) {
            return "none";
          }

          const style = getComputedStyle(first);

          return read === "opacity" ? style.opacity : style.transform;
        });

      return new Promise<Array<Frame>>((resolve) => {
        const seen: Array<Frame> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const at = performance.now() - start;

              seen.push({ at, values: readAll() });

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
    { wanted: readings, duration: forMs },
  );

  await trigger.click();

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

/** The times of the frames whose value at `index` passes `test`. */
const timesWhen = (frames: ReadonlyArray<Frame>, index: number, test: (value: string) => boolean) =>
  frames.flatMap(({ at, values }) => (test(values[index] ?? "") ? [at] : []));

test.describe("Review lines", () => {
  const leaving = { selector: '[data-slot="review-line"]', text: "PAYLINK *PIXELPLAY" };
  const below = { selector: '[data-slot="review-line"]', text: "CB CORNER BISTRO" };

  const approving = (page: Page) =>
    framesFromPress(page, page.getByRole("button", { name: "Approve PAYLINK *PIXELPLAY" }), [
      { ...leaving, read: "count" },
      { ...leaving, read: "opacity" },
      { ...below, read: "transform" },
    ]);

  test("an approved line fades out in 200 ms while the lines below slide up", async ({ page }) => {
    await page.goto(story("review-lines", "default"));
    await expect(page.getByRole("button", { name: "Approve PAYLINK *PIXELPLAY" })).toBeVisible();

    const frames = await approving(page);
    const present = timesWhen(frames, 0, (count) => count === "1");

    expect(timesWhen(frames, 1, fading).length).toBeGreaterThan(1);
    expect(timesWhen(frames, 2, moves).length).toBeGreaterThan(1);
    // Gone once its 200 ms are over, with room for a slow frame.
    expect(Math.max(...present)).toBeGreaterThan(150);
    expect(Math.max(...present)).toBeLessThan(450);
    expect(frames.at(-1)?.values).toEqual(["0", "none", expect.any(String)]);
    expect(moves(frames.at(-1)?.values[2])).toBe(false);
  });

  test("under reduced motion, an approved line goes at once and nothing slides", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("review-lines", "default"));
    await expect(page.getByRole("button", { name: "Approve PAYLINK *PIXELPLAY" })).toBeVisible();

    const frames = await approving(page);

    expect(timesWhen(frames, 1, fading)).toEqual([]);
    expect(timesWhen(frames, 2, moves)).toEqual([]);
    expect(Math.max(...timesWhen(frames, 0, (count) => count === "1"))).toBeLessThan(100);
  });
});

test.describe("Breakdown detail", () => {
  const panel = { selector: '[data-slot="breakdown-detail"]', text: "Housing" };
  const body = { selector: '[data-slot="breakdown-detail"] > div:last-child', text: "day by day" };

  const opening = (page: Page) =>
    framesFromPress(
      page,
      page.locator('[data-slot="breakdown"] button').filter({ hasText: "Housing" }),
      [
        { ...panel, read: "transform" },
        { ...body, read: "opacity" },
      ],
    );

  test("the row grows into its panel in 300 ms, the detail fading in after 100 ms", async ({
    page,
  }) => {
    await page.goto(story("breakdown", "opening-a-detail"));
    await expect(page.locator('[data-slot="breakdown"]')).toBeVisible();

    const frames = await opening(page);
    const growing = timesWhen(frames, 0, moves);
    const shown = timesWhen(frames, 1, (opacity) => opacity !== "none" && Number(opacity) > 0);

    expect(growing.length).toBeGreaterThan(1);
    expect(Math.max(...growing)).toBeGreaterThan(200);
    expect(Math.max(...growing)).toBeLessThan(550);
    // The detail waits 100 ms before it fades in, and is whole once its 200 ms are over.
    expect(Math.min(...shown)).toBeGreaterThan(80);
    expect(timesWhen(frames, 1, fading).length).toBeGreaterThan(1);
    expect(frames.at(-1)?.values).toEqual([expect.any(String), "1"]);
    expect(moves(frames.at(-1)?.values[0])).toBe(false);
  });

  test("under reduced motion, the panel and its detail are there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("breakdown", "opening-a-detail"));
    await expect(page.locator('[data-slot="breakdown"]')).toBeVisible();

    const frames = await opening(page);

    expect(timesWhen(frames, 0, moves)).toEqual([]);
    expect(timesWhen(frames, 1, fading)).toEqual([]);
    expect(frames.at(-1)?.values[1]).toBe("1");
  });
});
