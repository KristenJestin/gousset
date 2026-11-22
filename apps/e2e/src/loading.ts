import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Schema } from "effect";

/** What a block shows while its data is coming: `BlockSkeleton` in packages/ui. */
export const SKELETON = '[role="status"][aria-busy="true"]';

// Plain scripts, run in the page before any of its own: they only count, and the test reads the
// counts back. The layout shift is the browser's own measure (Chromium only: Firefox has no
// `layout-shift` entries, and reports `null`).
const WATCH = `
  window.__e2eSkeletons = 0;
  window.__e2eLayoutShift = PerformanceObserver.supportedEntryTypes.includes("layout-shift") ? 0 : null;

  if (window.__e2eLayoutShift !== null) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__e2eLayoutShift += entry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  }

  new MutationObserver(() => {
    if (document.querySelector(${JSON.stringify(SKELETON)}) !== null) {
      window.__e2eSkeletons += 1;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true });
`;

const Counts = Schema.Struct({
  skeletons: Schema.Number,
  layoutShift: Schema.NullOr(Schema.Number),
});

/** Waits until nothing animates any more: a block fading in would fail axe's contrast check. */
export async function animationsDone(page: Page): Promise<void> {
  await expect
    .poll(async () => Number(await page.evaluate("document.getAnimations().length")))
    .toBe(0);
}

/**
 * Watches every page the test opens from now on: how often a skeleton was on screen, and the
 * layout shift the browser measured. Call it before the first `goto`.
 */
export async function watchLoading(page: Page) {
  await page.addInitScript({ content: WATCH });

  return async () =>
    Schema.decodeUnknownSync(Counts)(
      await page.evaluate(
        "({ skeletons: window.__e2eSkeletons, layoutShift: window.__e2eLayoutShift })",
      ),
    );
}
