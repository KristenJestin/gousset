// TEMPORARY (#7): bisects Firefox's "Page crashed" on the sign-in page. Round 1: alive without
// axe in every variant. Round 2: axe, then a click on the e-mail field, kills Firefox's content
// process (signal 11), with or without color-contrast, on `main` alone, toaster elements removed.
// Round 3: the style sheets ui-sdk adopts on the document (with the `csp-nonce` meta). Every
// variant passes; each prints what happened, for the CI log. Removed before the pull request is
// merged.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { test } from "../src/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Variant = {
  name: string;
  /** Changes the sign-in page's HTML before the browser reads it. */
  rewrite?: (body: string) => string;
  /** Runs in the page before axe. */
  beforeAxe?: (page: Page) => Promise<void>;
  /** Runs in the page after axe, before the click. */
  afterAxe?: (page: Page) => Promise<void>;
  /** Leaves axe out. */
  noAxe?: boolean;
};

const dropAdoptedSheets = async (page: Page) => {
  await page.evaluate(() => {
    document.adoptedStyleSheets = [];
  });
};

const VARIANTS: Array<Variant> = [
  { name: "axe (control)" },
  { name: "adopted sheets dropped before axe", beforeAxe: dropAdoptedSheets },
  { name: "adopted sheets dropped after axe", afterAxe: dropAdoptedSheets },
  {
    name: "without the csp-nonce meta",
    rewrite: (body) => body.replace(/<meta property="csp-nonce"[^>]*>/, ""),
  },
  {
    name: "focus by script after axe, no pointer",
    afterAxe: async (page) => {
      await page.getByLabel("E-mail").focus();
    },
  },
  {
    name: "no axe, a style change on html",
    noAxe: true,
    afterAxe: async (page) => {
      await page.evaluate(() => {
        document.documentElement.dataset.diag = "x";
      });
    },
  },
];

function log(variant: string, line: string) {
  // oxlint-disable-next-line no-console -- temporary diagnostics, read in the CI log
  console.log(`[diag-firefox] ${variant}: ${line}`);
}

async function describeSheets(page: Page) {
  return page.evaluate(() =>
    document.adoptedStyleSheets
      .map(
        (sheet) => `${sheet.cssRules.length} rule(s): ${sheet.cssRules[0]?.cssText.slice(0, 80)}`,
      )
      .join(" | "),
  );
}

async function run(page: Page, variant: Variant) {
  let crashed = false;

  page.on("crash", () => {
    crashed = true;
    log(variant.name, "crash event");
  });
  page.on("pageerror", (error) => log(variant.name, `pageerror ${error.message}`));

  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("load");
    log(variant.name, `loaded; adopted sheets: ${await describeSheets(page)}`);
    await variant.beforeAxe?.(page);

    if (variant.noAxe !== true) {
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

      log(variant.name, `axe done, ${results.violations.length} violation(s)`);
    }

    await variant.afterAxe?.(page);
    await page.waitForTimeout(1000);
    log(variant.name, crashed ? "crashed before the click" : "alive before the click");
    await page.getByLabel("E-mail").click({ timeout: 5000 });
    await page.waitForTimeout(500);
    log(variant.name, crashed ? "crashed at the click" : "clicked the e-mail field");
    await page.getByLabel("E-mail").fill("ada@example.com", { timeout: 5000 });
    log(variant.name, "filled the e-mail field");
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
    const { rewrite } = variant;

    if (rewrite !== undefined) {
      await page.route("**/sign-in", async (route) => {
        const response = await route.fetch();

        await route.fulfill({ response, body: rewrite(await response.text()) });
      });
    }

    try {
      await run(page, variant);
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}
