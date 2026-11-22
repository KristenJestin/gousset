import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** WCAG 2.2 A and AA, the level Gousset holds (docs/architecture.md, "Quality"). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Runs axe on the screen as it is now; any violation fails the test, listed by rule, then each
 * element it found with what axe says of it: a CI log is enough to find and fix it.
 */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

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
