import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../src/test";

// TEMPORARY, removed before the pull request is ready: finds which axe rule, run alone on the
// settings with the single-key shortcuts switch, leaves Firefox's content process to crash. Each
// rule gets a page of its own; a test that fails names a rule that crashes it.

/** axe-core 4.14.1's rules for Gousset's WCAG tags (`axe.getRules(WCAG_TAGS)`). */
const RULES = [
  "area-alt",
  "aria-allowed-attr",
  "aria-braille-equivalent",
  "aria-command-name",
  "aria-conditional-attr",
  "aria-deprecated-role",
  "aria-hidden-body",
  "aria-hidden-focus",
  "aria-input-field-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-prohibited-attr",
  "aria-required-attr",
  "aria-required-children",
  "aria-required-parent",
  "aria-roledescription",
  "aria-roles",
  "aria-tab-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "aria-valid-attr-value",
  "aria-valid-attr",
  "autocomplete-valid",
  "avoid-inline-spacing",
  "button-name",
  "bypass",
  "color-contrast",
  "css-orientation-lock",
  "definition-list",
  "dlitem",
  "document-title",
  "duplicate-id-aria",
  "form-field-multiple-labels",
  "html-has-lang",
  "html-lang-valid",
  "image-alt",
  "input-button-name",
  "label-content-name-mismatch",
  "label",
  "link-in-text-block",
  "link-name",
  "list",
  "listitem",
  "meta-viewport",
  "nested-interactive",
  "p-as-heading",
  "role-img-alt",
  "scrollable-region-focusable",
  "select-name",
  "svg-img-alt",
  "target-size",
  "valid-lang",
] as const;

/** Uses the page as the tests do after axe: reads and toggles the switch, twice. */
async function useSettings(page: Page) {
  const setting = page.getByRole("switch", { name: "Single-key shortcuts" });

  await setting.isChecked();
  await setting.click();
  await setting.click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.title)).not.toBe("");
}

async function openSettings(page: Page) {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
}

test.describe("firefox crash probe", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      browserName !== "firefox" || !testInfo.project.name.includes("desktop"),
      "Firefox on a desktop only.",
    );
  });

  test("probe: no axe at all", async ({ userPage }) => {
    await openSettings(userPage);
    await useSettings(userPage);
    // Closed, so that the harness's own axe at the end does not run.
    await userPage.close();
  });

  for (const rule of RULES) {
    test(`probe: axe rule ${rule} alone`, async ({ userPage }) => {
      await openSettings(userPage);
      await new AxeBuilder({ page: userPage }).withRules([rule]).analyze();
      await useSettings(userPage);
      await userPage.close();
    });
  }
});
