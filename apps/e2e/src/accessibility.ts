import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import axe from "axe-core";

/** WCAG 2.2 A and AA, the level Gousset holds (docs/architecture.md, "Quality"). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The ARIA relations Firefox reflects as element properties (`ariaLabelledByElements`...), which
 * axe reads from their attribute instead in Firefox.
 *
 * Playwright 1.65's Firefox (build 1572) writes through a null pointer, and its content process
 * dies ("Page crashed", signal 11), once both the page and Playwright's own script read one
 * element's `ariaLabelledByElements` (Mozilla bug 2090055, microsoft/playwright#44135). axe-core
 * 4.14 reads it in the page for every name it computes; `getByRole(..., { name })` and
 * `getByLabel` read it in Playwright's. A scan and a role query on one page, in either order, then
 * crash it sooner or later: at the end of the scan, or at the next action. Firefox build 1575
 * fixes it, from Playwright 1.66; drop this then.
 *
 * The attribute gives axe the same elements: Gousset sets these relations as attributes only,
 * never through the properties.
 */
const ELEMENT_REFLECTIONS = [
  "aria-actions",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
];

const AXE_READING_ATTRIBUTES = `${axe.source}
;axe.configure({ standards: { ariaAttrs: ${JSON.stringify(
  Object.fromEntries(ELEMENT_REFLECTIONS.map((attribute) => [attribute, { prop: "" }])),
)} } });`;

/**
 * The popups on their first frame (`data-starting-style`), whose transition has not started yet and
 * so lists no animation, and those leaving (`data-ending-style`): `ENTRANCES_DONE` alone, run then,
 * finds nothing to wait for, and axe reads the popup as it fades in. A dialog opened a moment
 * before was read at 3.8 where it holds 4.5 (#30's merchant dialog).
 */
const POPUPS_MOVING = `document.querySelectorAll("[data-starting-style], [data-ending-style]").length`;

/**
 * Waits for the screen's entrance animations to end: text still fading in is half transparent, and
 * axe would measure its contrast mid-fade. Endless animations (a loader, a skeleton) are not
 * waited for.
 */
const ENTRANCES_DONE = `Promise.all(
  document
    .getAnimations()
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map((animation) => animation.finished.catch(() => undefined)),
).then(() => undefined)`;

/**
 * Runs axe on the screen once its entrance animations ended; any violation fails the test, listed
 * by rule, then each element it found with what axe says of it: a CI log is enough to find and
 * fix it.
 */
export async function expectAccessible(page: Page): Promise<void> {
  // Every popup past its first frame and its exit, as #151's checks of the overlays wait for it,
  // then every entrance listed by then.
  await expect.poll(async () => Number(await page.evaluate(POPUPS_MOVING))).toBe(0);
  await page.evaluate(ENTRANCES_DONE);

  const firefox = page.context().browser()?.browserType().name() === "firefox";

  // Every browser scans with the axe this harness pins, so that they run the same version.
  const results = await new AxeBuilder({
    page,
    axeSource: firefox ? AXE_READING_ATTRIBUTES : axe.source,
  })
    .withTags(WCAG_TAGS)
    .analyze();

  const violations = results.violations.flatMap((violation) => [
    `${violation.id} (${violation.impact ?? "?"}): ${violation.help}, ${violation.nodes.length} element(s)`,
    ...violation.nodes.map(
      (node) =>
        `  ${node.target.join(" ")}: ${(node.failureSummary ?? "").replaceAll(/\s+/g, " ").trim()}`,
    ),
  ]);

  expect(violations, `axe found violations on ${page.url()}`).toEqual([]);
}

/** Opens a screen, waits for it to load, and checks it with axe: how a scenario visits a screen. */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
  await expectAccessible(page);
}
