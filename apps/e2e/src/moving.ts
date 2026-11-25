import type { Page } from "@playwright/test";
import { Schema } from "effect";

const Descriptions = Schema.Array(Schema.String);

/** A page script's helper: an element as a failure message names it. */
const NAMED = `(target) => {
  if (!(target instanceof Element)) {
    return String(target);
  }

  const slot = target.getAttribute("data-slot");
  const text = (target.textContent ?? "").replaceAll(/\\s+/g, " ").trim().slice(0, 40);

  return target.localName + (slot === null ? "" : '[data-slot="' + slot + '"]') +
    (target.isConnected ? "" : " (detached)") + ' "' + text + '"';
}`;

/**
 * The elements whose transform the page's script changed between two frames, each with its value
 * before and after. Motion drives its layout animations (a row sliding to its place, a row growing
 * into its panel and back, #32) by writing the element's `style.transform` at each frame, from
 * script: `document.getAnimations()` does not list them. Read at two consecutive frames, a
 * transform still under such an animation differs, since Motion writes it once a frame; one at
 * rest, moved or not, stays the same. An element that gains or loses its transform counts as
 * moving for that frame.
 */
const TRANSFORMS_MOVING = `(() => {
  const named = ${NAMED};
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const transforms = () =>
    new Map(
      [...document.querySelectorAll('[style*="transform"]')].map((element) => [
        element,
        element.style.transform,
      ]),
    );

  return frame()
    .then(() => {
      const before = transforms();

      return frame().then(() => [before, transforms()]);
    })
    .then(([before, after]) =>
      [...new Set([...before.keys(), ...after.keys()])].flatMap((element) => {
        const from = before.get(element) ?? "";
        const to = after.get(element) ?? "";

        return from === to ? [] : [named(element) + ": transform " + from + " -> " + to];
      }),
    );
})()`;

/**
 * Every animation `document.getAnimations()` lists, described: its kind, what it animates, its
 * element, its state and its timing. A failure that waited on one says which, and why it is still
 * there (a loop, a paused one, one that restarts).
 */
const ANIMATIONS_LISTED = `(() => {
  const named = ${NAMED};
  const meta = new Set(["offset", "computedOffset", "easing", "composite"]);

  return document.getAnimations().map((animation) => {
    const effect = animation.effect;
    const timing = effect?.getComputedTiming();
    const what =
      animation.animationName ??
      animation.transitionProperty ??
      Object.keys(effect?.getKeyframes?.()[0] ?? {}).filter((key) => !meta.has(key)).join(",");

    // DEBUG #167, temporary: which animation (restarted or not), and the clocks.
    window.__e2eIds ??= new WeakMap();
    if (!window.__e2eIds.has(animation)) {
      window.__e2eIds.set(animation, (window.__e2eNext = (window.__e2eNext ?? 0) + 1));
    }
    const debug = " #" + window.__e2eIds.get(animation) + " start " + String(animation.startTime) +
      " timeline " + String(document.timeline.currentTime) + " now " + performance.now().toFixed(1) +
      " visibility " + document.visibilityState + " opacity " + getComputedStyle(effect.target).opacity;

    return debug + " " + animation.constructor.name + " " + what + " on " + named(effect?.target) +
      (effect?.pseudoElement ? effect.pseudoElement : "") + ": " + animation.playState +
      (animation.pending ? " (pending)" : "") + ", at " + String(animation.currentTime) + " of " +
      String(timing?.endTime) + " ms, " + String(timing?.iterations) + " iteration(s), fill " +
      String(timing?.fill);
  });
})()`;

/** What still moves under Motion's layout animations, one line each; empty once all are at rest. */
export async function transformsMoving(page: Page): Promise<ReadonlyArray<string>> {
  return Schema.decodeUnknownSync(Descriptions)(await page.evaluate(TRANSFORMS_MOVING));
}

/** Every animation the page lists, one line each; empty when none is. */
export async function animationsListed(page: Page): Promise<ReadonlyArray<string>> {
  return Schema.decodeUnknownSync(Descriptions)(await page.evaluate(ANIMATIONS_LISTED));
}
