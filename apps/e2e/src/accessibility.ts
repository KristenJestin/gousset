import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** WCAG 2.2 A and AA, the level Gousset holds (docs/architecture.md, "Quality"). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Rules left out in Firefox only, each for a crash of the browser under test, not of the app:
 * Chromium runs them on every screen, so the suite still covers them.
 *
 * `label`: after axe-core 4.14.1 runs it in Playwright 1.65.1's Firefox (build 1572), the next
 * focus of a ui-sdk text field (a `<label>` and its `<input>` in a `Field`) kills the content
 * process (signal 11). The same pages, focused and typed into without axe, stay alive; every
 * other rule alone leaves them alive too.
 *
 * `button-name`: the same crash, on the app's frame. After that rule alone runs on the review, the
 * next click (the month, the user's menu, the tab bar's "More") kills the content process; every
 * other WCAG rule alone, run on the same page, leaves it alive, and so does no axe at all.
 *
 * `label-content-name-mismatch`: the same crash, on the settings once they hold a ui-sdk `Switch`
 * (a `role="switch"` named by its field's `<label>`). After that rule alone runs there, the next
 * call to the page kills its content process; every other WCAG rule alone (but `button-name`,
 * above) leaves it alive, and so does no axe at all.
 */
const FIREFOX_CRASHING_RULES = ["label", "button-name", "label-content-name-mismatch"];

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

/** Runs axe on the screen once its entrance animations ended; any violation fails the test, listed by rule. */
export async function expectAccessible(page: Page): Promise<void> {
  await page.evaluate(ENTRANCES_DONE);

  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);

  if (page.context().browser()?.browserType().name() === "firefox") {
    builder.disableRules(FIREFOX_CRASHING_RULES);
  }

  const results = await builder.analyze();

  const violations = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "?"}): ${violation.help}, ${violation.nodes.length} element(s)`,
  );

  expect(violations, `axe found violations on ${page.url()}`).toEqual([]);
}

/** Opens a screen, waits for it to load, and checks it with axe: how a scenario visits a screen. */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("load");
  await expectAccessible(page);
}
