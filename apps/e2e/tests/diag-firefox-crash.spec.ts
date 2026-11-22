// TEMPORARY (#7): bisects Firefox's "Page crashed". Round 1: alive without axe in every variant.
// Round 2: axe, then a click on the e-mail field, kills Firefox's content process (signal 11), with
// or without color-contrast, on `main` alone, toaster elements removed. Round 3: not the adopted
// sheets, not the csp-nonce meta; a focus by script crashes as a click does; without axe, alive.
// Round 4: which part of axe. Every variant passes; each prints what happened, for the CI log.
// Removed before the pull request is merged.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { test } from "../src/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Variant = { name: string; axe: (page: Page) => AxeBuilder };

const tags = (page: Page, list: Array<string>) => new AxeBuilder({ page }).withTags(list);
const only = (page: Page, rules: Array<string>) => new AxeBuilder({ page }).withRules(rules);

const VARIANTS: Array<Variant> = [
  { name: "axe (control)", axe: (page) => tags(page, WCAG_TAGS) },
  { name: "axe's setup and one trivial rule", axe: (page) => only(page, ["html-has-lang"]) },
  { name: "color-contrast alone", axe: (page) => only(page, ["color-contrast"]) },
  { name: "label alone", axe: (page) => only(page, ["label"]) },
  { name: "region alone", axe: (page) => only(page, ["region"]) },
  { name: "target-size alone", axe: (page) => only(page, ["target-size"]) },
  { name: "tags wcag2a alone", axe: (page) => tags(page, ["wcag2a"]) },
  { name: "tags wcag2aa alone", axe: (page) => tags(page, ["wcag2aa"]) },
  {
    name: "tags wcag21a, wcag21aa, wcag22aa",
    axe: (page) => tags(page, ["wcag21a", "wcag21aa", "wcag22aa"]),
  },
];

function log(variant: string, line: string) {
  // oxlint-disable-next-line no-console -- temporary diagnostics, read in the CI log
  console.log(`[diag-firefox] ${variant}: ${line}`);
}

async function run(page: Page, variant: Variant) {
  let crashed = false;

  page.on("crash", () => {
    crashed = true;
    log(variant.name, "crash event");
  });

  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("load");

    const results = await variant.axe(page).analyze();

    log(variant.name, `axe done, ${results.passes.length} rule(s) passed`);
    await page.waitForTimeout(500);
    await page.getByLabel("E-mail").focus({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.getByLabel("E-mail").fill("ada@example.com", { timeout: 5000 });
  } catch (error) {
    log(variant.name, `stopped: ${error instanceof Error ? error.message.split("\n")[0] : "?"}`);
  }

  log(variant.name, crashed ? "RESULT crashed" : "RESULT alive");
}

// Only in CI's own diagnostics step, which may fail: never in the suite itself.
test.skip(process.env.GOUSSET_DIAG !== "1", "diagnostics: CI's own step only");

for (const variant of VARIANTS) {
  test(`diag: sign-in, ${variant.name}`, async ({ browser, app }) => {
    const context = await browser.newContext({ baseURL: app.baseURL });
    const page = await context.newPage();

    try {
      await run(page, variant);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}
