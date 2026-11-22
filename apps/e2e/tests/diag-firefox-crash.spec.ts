// TEMPORARY (#8): finds which axe rule, run in Playwright's Firefox, makes a later click in the
// frame kill the content process, as `label` does on a text field (src/accessibility.ts). Each
// test runs one rule alone on the review, then clicks the month, the user's menu and a link, and
// prints what happened, for the CI log; every test passes. Removed before the pull request is
// merged.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { test } from "../src/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** axe-core's WCAG 2.2 A and AA rules that can apply to the review in its frame. */
const RULES = [
  "aria-allowed-attr",
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
  "aria-roles",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "aria-valid-attr-value",
  "aria-valid-attr",
  "button-name",
  "bypass",
  "color-contrast",
  "definition-list",
  "dlitem",
  "document-title",
  "duplicate-id-aria",
  "form-field-multiple-labels",
  "html-has-lang",
  "html-lang-valid",
  "html-xml-lang-mismatch",
  "image-alt",
  "input-button-name",
  "link-in-text-block",
  "link-name",
  "list",
  "listitem",
  "meta-viewport",
  "nested-interactive",
  "role-img-alt",
  "scrollable-region-focusable",
  "select-name",
  "svg-img-alt",
  "target-size",
  "valid-lang",
];

type Variant = {
  name: string;
  /** axe as the variant runs it; none skips axe. */
  axe?: (page: Page) => AxeBuilder;
};

const VARIANTS: Array<Variant> = [
  { name: "no axe" },
  {
    name: "every rule but label, as the harness runs it",
    axe: (page) => new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(["label"]),
  },
  ...RULES.map((rule) => ({
    name: `${rule} alone`,
    axe: (page: Page) => new AxeBuilder({ page }).withRules([rule]),
  })),
];

function log(variant: string, line: string) {
  // oxlint-disable-next-line no-console -- temporary diagnostics, read in the CI log
  console.log(`[diag-firefox] ${variant}: ${line}`);
}

async function axeThenClicks(page: Page, variant: Variant, userName: string) {
  let crashed = false;

  page.on("crash", () => {
    crashed = true;
  });

  try {
    await page.goto("/");
    await page.waitForLoadState("load");

    if (variant.axe !== undefined) {
      await variant.axe(page).analyze();
    }

    await page
      .getByRole("group", { name: "Month" })
      .getByRole("button", { name: "Previous month" })
      .click({ timeout: 5000 });
    log(variant.name, "clicked the month");
    await page.getByRole("button", { name: userName }).click({ timeout: 5000 });
    log(variant.name, "opened the user's menu");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Accounts" }).click({ timeout: 5000 });
    await page.waitForTimeout(500);
  } catch (error) {
    log(variant.name, `stopped: ${error instanceof Error ? error.message.split("\n")[0] : "?"}`);
  }

  log(variant.name, crashed ? "RESULT crashed" : "RESULT alive");
}

for (const variant of VARIANTS) {
  test(`diag: the review, ${variant.name}`, async ({ userPage, user }, testInfo) => {
    test.skip(testInfo.project.name !== "firefox-desktop", "Firefox's crash, on a desktop.");
    await axeThenClicks(userPage, variant, user.name);
  });
}
