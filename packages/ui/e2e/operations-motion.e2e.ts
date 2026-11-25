import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=operations-${component}--${name}&viewMode=story`;

/**
 * What to read at each frame, on the elements `selector` matches whose text holds `text`: how many
 * there are, or the first one's computed opacity or transform, or the top, left or width of its box
 * as drawn ("none" when there is none).
 */
type Reading = {
  selector: string;
  text: string;
  read: "count" | "opacity" | "transform" | "top" | "left" | "width";
};

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

          if (read === "top" || read === "left" || read === "width") {
            return String(Math.round(first.getBoundingClientRect()[read]));
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

/** How far the page's clock runs ahead of its animations' timeline, in a test that says so. */
const CLOCK_LEAD_MS = 4000;

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

  // Firefox's animation timeline can trail performance.now(), Motion's clock, by seconds (4.4 s
  // after a reload in CI): a fade Motion started on its own clock waited that long, the row still
  // whole over the list (#167). Here every browser's clock leads its timeline by 4 s; the row still
  // fades out in its 200 ms, and leaves.
  test("a row leaves on time when the page's clock leads the animations' timeline", async ({
    page,
  }) => {
    await page.addInitScript({
      content: `
        const now = performance.now.bind(performance);

        performance.now = () => now() + ${String(CLOCK_LEAD_MS)};
      `,
    });
    await page.goto(story("operationslist", "changing-rows"));
    await expect(page.locator(ROW).first()).toBeVisible();

    // From the press to the moment the leaving row is out of the page: the clock leads, but runs
    // at its pace. That row's own element, the first of its text, as the samples above read it: the
    // made-up lines repeat their labels further down.
    const gone = page.evaluate(
      ({ selector, text }) =>
        new Promise<number>((resolve) => {
          document.addEventListener(
            "pointerdown",
            () => {
              const pressed = performance.now();

              const row = [...document.querySelectorAll(selector)].find((each) =>
                (each.textContent ?? "").includes(text),
              );

              new MutationObserver((_, observer) => {
                if (row?.isConnected !== true) {
                  observer.disconnect();
                  resolve(performance.now() - pressed);
                }
              }).observe(document.body, { subtree: true, childList: true });
            },
            { once: true, capture: true },
          );
        }),
      leaving,
    );

    await page.getByRole("button", { name: "Only lines to review" }).click();
    expect(await gone).toBeLessThan(1000);
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

const LABEL = "CB GREENMARKET 2110";

const openingRow = (page: Page) =>
  page.locator(ROW).filter({ hasText: LABEL }).first().getByRole("button");

/** The open line's detail: the side sheet, named by its label. */
const detailSheet = (page: Page) =>
  page.getByRole("dialog", { name: "CB GREENMARKET 2110 RIVERTON" });

/** The list's width as drawn. */
const listWidth = (page: Page) =>
  page
    .locator('[data-slot="operations-scroller"]')
    .evaluate((node) => Math.round(node.getBoundingClientRect().width));

/** The times of the frames that draw the sheet right of where it rests (`rest`, its left). */
const offRightEdge = (frames: ReadonlyArray<Frame>, rest: number) =>
  timesWhen(frames, 0, (left) => left !== "none" && Number(left) > rest + 1);

/** Where the open side sheet rests: its left, once it stands still. */
async function restingLeft(page: Page) {
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);

  return detailSheet(page).evaluate((node) => Math.round(node.getBoundingClientRect().left));
}

/** Opens the line and waits until its sheet stands still. */
async function openAndSettle(page: Page) {
  await openingRow(page).click();
  await expect(detailSheet(page)).toBeVisible();

  return restingLeft(page);
}

/** The side sheet's left and the list's width at each frame. */
const sheetAndList: ReadonlyArray<Reading> = [
  { selector: '[role="dialog"]', text: LABEL, read: "left" },
  { selector: '[data-slot="operations-scroller"]', text: "", read: "width" },
];

test.describe("Line detail in the side sheet", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A side sheet from 768 px on");
    await page.goto(story("operationslayout", "desktop"));
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  // #182: on a wide screen as on a tablet, the detail is a sheet over the list, never a column
  // beside it.
  for (const width of [1280, 900]) {
    test(`${String(width)} px wide, opening, it slides in from the right edge over the list in 300 ms, the list left whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });

      const before = await listWidth(page);
      const opening = await sampleFrames(page, sheetAndList, { trigger: openingRow(page) });

      await expect(detailSheet(page)).toBeVisible();

      const rest = await restingLeft(page);
      const sliding = offRightEdge(opening, rest);

      // It slid in from beyond the right edge, in about 300 ms, and rests along it.
      expect(sliding.length).toBeGreaterThan(2);
      expect(Math.max(...sliding)).toBeGreaterThan(150);
      expect(Math.max(...sliding)).toBeLessThan(550);
      expect(Number(opening.at(-1)?.values[0])).toBe(rest);
      expect(
        await detailSheet(page).evaluate((node) => Math.round(node.getBoundingClientRect().right)),
      ).toBe(width);
      // Over the list, which kept its width at every frame: no column beside it.
      expect(new Set(opening.map(({ values }) => values[1]))).toEqual(new Set([String(before)]));
      await expect(page.locator('[data-slot="operations-detail"]')).toHaveCount(0);
      // Its label and amount at its top, the focus in it.
      await expect(detailSheet(page).locator('[data-slot="amount"]').first()).toBeVisible();
      await expect(detailSheet(page)).toBeFocused();
    });
  }

  test("closing, it slides back out and the focus goes back to its row", async ({ page }) => {
    const rest = await openAndSettle(page);

    const closing = await sampleFrames(page, sheetAndList, {
      trigger: detailSheet(page).getByRole("button", { name: "Close" }),
    });

    expect(offRightEdge(closing, rest).length).toBeGreaterThan(1);
    await expect(detailSheet(page)).toHaveCount(0);
    await expect(openingRow(page)).toBeFocused();
  });

  test("under reduced motion, the sheet is there, or not", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    const opening = await sampleFrames(page, sheetAndList, { trigger: openingRow(page) }, 400);
    const rest = await restingLeft(page);

    expect(opening.some(({ values }) => values[0] !== "none")).toBe(true);
    expect(offRightEdge(opening, rest)).toEqual([]);

    const closing = await sampleFrames(
      page,
      sheetAndList,
      { trigger: detailSheet(page).getByRole("button", { name: "Close" }) },
      400,
    );

    expect(offRightEdge(closing, rest)).toEqual([]);
    await expect(detailSheet(page)).toHaveCount(0);
  });

  test("Escape closes it and gives the focus back to its row", async ({ page }) => {
    await openingRow(page).click();
    await expect(detailSheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="line-detail"]')).toHaveCount(0);
    await expect(openingRow(page)).toBeFocused();
  });
});

/** The times of the frames that draw the sheet below where it rests (`rest`, its top). */
const offEdge = (frames: ReadonlyArray<Frame>, rest: number) =>
  timesWhen(frames, 0, (top) => top !== "none" && Number(top) > rest + 1);

/** Where the open sheet rests: its top, once it stands still. */
async function restingTop(page: Page) {
  const dialog = page.getByRole("dialog");

  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);

  return dialog.evaluate((node) => Math.round(node.getBoundingClientRect().top));
}

test.describe("Line detail on a phone", () => {
  // The sheet's top as drawn: its slide is a `translate`, which the box carries.
  const sheet = { selector: '[role="dialog"]', text: LABEL };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(story("operationslayout", "desktop"));
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test("the detail is a sheet that slides up from the bottom in 300 ms and back down", async ({
    page,
  }) => {
    const opening = await sampleFrames(page, [{ ...sheet, read: "top" }], {
      trigger: openingRow(page),
    });

    const dialog = page.getByRole("dialog", { name: "CB GREENMARKET 2110 RIVERTON" });

    await expect(dialog).toBeVisible();

    const rest = await restingTop(page);
    const rising = offEdge(opening, rest);

    expect(rising.length).toBeGreaterThan(2);
    expect(Math.max(...rising)).toBeGreaterThan(150);
    expect(Math.max(...rising)).toBeLessThan(550);
    expect(Number(opening.at(-1)?.values[0])).toBe(rest);
    // Its label and amount at its top.
    await expect(dialog.locator('[data-slot="amount"]').first()).toBeVisible();

    const closing = await sampleFrames(page, [{ ...sheet, read: "top" }], {
      trigger: dialog.getByRole("button", { name: "Close" }),
    });

    expect(offEdge(closing, rest).length).toBeGreaterThan(1);
    await expect(dialog).toHaveCount(0);
    await expect(openingRow(page)).toBeFocused();
  });

  test("under reduced motion, the sheet is there, or not", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    const opening = await sampleFrames(
      page,
      [{ ...sheet, read: "top" }],
      {
        trigger: openingRow(page),
      },
      400,
    );

    const rest = await restingTop(page);

    expect(opening.some(({ values }) => values[0] !== "none")).toBe(true);
    expect(offEdge(opening, rest)).toEqual([]);

    const closing = await sampleFrames(
      page,
      [{ ...sheet, read: "top" }],
      { trigger: page.getByRole("dialog").getByRole("button", { name: "Close" }) },
      400,
    );

    expect(offEdge(closing, rest)).toEqual([]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // #164: the sheet put up again for the next line would land over a dialog opened since.
  test("from one line to the next, the sheet stays open and still, the focus on the next line", async ({
    page,
  }) => {
    await page.goto(story("operationslayout", "phone-next-line"));
    await stepsStill(page, "top");
  });
});

// #182: the side sheet, too, stays open from one line to the next, on a wide screen.
test("on a wide screen, from one line to the next, the side sheet stays open and still, the focus on the next line", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A side sheet from 768 px on");
  await page.goto(story("operationslayout", "next-line"));
  await stepsStill(page, "left");
});

/**
 * From the open line to the next (the story's "Next line"): the same sheet, never put up again,
 * its title the next line's, its edge (`edge`: its top on a phone, its left on a wide screen) where
 * it was or at the next line's height at once, never sliding; the focus on the next line's proposal.
 */
async function stepsStill(page: Page, edge: "top" | "left") {
  const dialog = page.getByRole("dialog");
  const title = dialog.locator('[id$="-title"]');

  await expect(dialog).toBeVisible();

  await restingTop(page);

  const first = await title.textContent();

  // The same element after: a sheet put up again would be a new one.
  await dialog.evaluate((node) => node.setAttribute("data-e2e-first", ""));

  const stepping = await sampleFrames(
    page,
    [{ selector: '[role="dialog"]', text: "", read: edge }],
    { trigger: dialog.getByRole("button", { name: "Next line" }) },
    400,
  );

  await expect(title).not.toHaveText(first ?? "");
  await expect(page.locator('[role="dialog"][data-e2e-first]')).toHaveCount(1);
  expect(stepping.every(({ values }) => values[0] !== "none")).toBe(true);
  // Still: its edge jumps to the next line's place at once, never sliding there.
  expect(new Set(stepping.map(({ values }) => values[0])).size).toBeLessThanOrEqual(2);
  await expect(dialog.locator('[data-slot="line-review"]')).toBeFocused();
}
