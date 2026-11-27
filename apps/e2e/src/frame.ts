import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** Below this width the frame shows the tab bar instead of the sidebar (`AppShell`). */
const SIDEBAR_FROM = 768;

/** Whether the page shows the phone's tab bar rather than the sidebar. */
export function onPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? SIDEBAR_FROM) < SIDEBAR_FROM;
}

/**
 * A line's open detail on the operations page, named by its label: a sheet (a dialog) over the
 * list on every screen (#182), from the right edge on a wide screen, from the bottom on a phone.
 */
export function lineDetail(page: Page, label: string): Locator {
  return page.getByRole("dialog", { name: label });
}

/**
 * How much of a line's open detail the eye gets (#158): its content's opacity, its own times every
 * parent's, and how many animations or transitions with an end are still under way on it or on a
 * parent (a loop, like a loader's, never ends and is not counted).
 */
export type DetailSight = { opacity: number; moving: number };

/** What `lineDetail` shows of its content: the sheet's body. */
export async function detailSight(detail: Locator): Promise<DetailSight> {
  return detail
    .locator('[data-slot="line-detail"]')
    .first()
    .evaluate((content) => {
      let opacity = 1;
      let moving = 0;

      for (let node: Element | null = content; node !== null; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
        moving += node
          .getAnimations()
          .filter(
            (animation) =>
              Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
              animation.playState !== "finished" &&
              animation.playState !== "idle",
          ).length;
      }

      return { opacity, moving };
    });
}

/**
 * Waits until a line's open detail stands still: its column no longer widens, its content no longer
 * slides in, its sheet no longer rises (`detailSight`'s `moving`). Playwright presses a button where
 * it stood when found stable, which Firefox may judge before the opening has begun to move; the
 * button moving on, the release lands beside it and the click is lost (#223). Click in a detail
 * once it rests.
 *
 * A phone's sheet rises once ui-sdk takes its `data-starting-style` off, a frame after it shows:
 * until then nothing moves yet, so the wait also holds while the sheet still carries it.
 */
export async function detailAtRest(detail: Locator): Promise<void> {
  await expect
    .poll(async () => {
      // Read first: taken off after this, its rise is under way when `moving` is read.
      const starting = await detail
        .locator('[data-slot="line-detail-content"], [data-slot="line-detail"]')
        .first()
        .evaluate((content) => content.closest("[data-starting-style]") !== null);

      const { moving } = await detailSight(detail);

      return moving === 0 && !starting;
    })
    .toBe(true);
}

/**
 * Waits until no sheet or dialog is left on the page, its exit over, its backdrop gone with it.
 * While one leaves (200 ms), ui-sdk drops a press over its backdrop on purpose, though the page
 * under it is no longer inert (`plan` in `@ui-sdk/core`'s `foundation/platform/layers.js`: an
 * exiting modal layer consumes a press inside its backdrop's box), so that the second click of a
 * double-click there reaches nothing: a click on the page waits for this. Found by its attribute,
 * not its role: a leaving one is out of the accessibility tree.
 */
export async function sheetGone(page: Page): Promise<void> {
  await expect(
    page.locator('[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])'),
  ).toHaveCount(0);
}

/** What the eye gets of a text: whether it is drawn on top, and its contrast with what is under. */
export type TextSight = { onTop: boolean; contrast: number };

/** A colour as sRGB bytes. */
type Rgb = { r: number; g: number; b: number };

/** One sRGB byte, linearised (WCAG). */
function linear(byte: number) {
  const value = byte / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
function luminance(color: Rgb) {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/**
 * Whether `text` is the topmost element at its centre, nothing painted over it, and the WCAG
 * contrast of its colour with the first opaque background drawn under it there, whichever element
 * draws it (a link's current mark is a sibling, not a parent). Colours are read through a canvas,
 * so that any space the browser computes them in reaches the formula as sRGB.
 */
export async function textSight(text: Locator): Promise<TextSight> {
  const seen = await text.evaluate((element) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) {
      throw new Error("No 2D canvas to read colours with");
    }

    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);

      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;

      return { r, g, b, a };
    };

    const box = element.getBoundingClientRect();
    const layers = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const top = layers.at(0);

    const surface = layers
      .map((layer) => rgba(getComputedStyle(layer).backgroundColor))
      .find((color) => color.a === 255);

    if (surface === undefined) {
      throw new Error("Nothing opaque is drawn under the text");
    }

    return {
      onTop: top !== undefined && element.contains(top),
      color: rgba(getComputedStyle(element).color),
      surface,
    };
  });

  const [lighter = 0, darker = 0] = [luminance(seen.color), luminance(seen.surface)].toSorted(
    (first, second) => second - first,
  );

  return { onTop: seen.onTop, contrast: (lighter + 0.05) / (darker + 0.05) };
}

/**
 * Opens the menu that holds the account's actions: the user's menu in the sidebar (named by who
 * is signed in), or "More" in the phone's tab bar. Returns the open menu.
 */
export async function openAccountMenu(page: Page, userName: string): Promise<Locator> {
  const trigger = onPhone(page)
    ? page.getByRole("button", { name: "More" })
    : page.getByRole("button", { name: userName });

  await trigger.click();

  const menu = page.getByRole("menu");

  await menu.waitFor();

  return menu;
}
