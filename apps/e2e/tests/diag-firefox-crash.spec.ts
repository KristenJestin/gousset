// TEMPORARY (#7): bisects Firefox's "Page crashed" on the sign-in page. The first round showed the
// page alive without axe in every variant; every crashing test runs axe first (`visit`). Every
// variant passes; each prints what happened, for the CI log. Removed before the pull request is
// merged.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { test } from "../src/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Variant = {
  name: string;
  javaScript?: boolean;
  /** Runs before axe, in the page. */
  prepare?: (page: Page) => Promise<void>;
  /** axe as the variant runs it; none skips axe. */
  axe?: (page: Page) => AxeBuilder;
};

const wcag = (page: Page) => new AxeBuilder({ page }).withTags(WCAG_TAGS);

const VARIANTS: Array<Variant> = [
  { name: "axe as visit runs it", axe: wcag },
  { name: "axe without JavaScript", javaScript: false, axe: wcag },
  {
    name: "axe without color-contrast",
    axe: (page) => wcag(page).disableRules(["color-contrast"]),
  },
  { name: "axe on main alone", axe: (page) => wcag(page).include("main") },
  {
    name: "toaster removed, then axe",
    prepare: async (page) => {
      await page.evaluate(() => {
        for (const element of document.querySelectorAll(
          '[aria-label="Notifications"], [data-ui-sdk-announcer]',
        )) {
          element.remove();
        }
      });
    },
    axe: wcag,
  },
];

function log(variant: string, line: string) {
  // oxlint-disable-next-line no-console -- temporary diagnostics, read in the CI log
  console.log(`[diag-firefox] ${variant}: ${line}`);
}

async function tryAxeThenTyping(page: Page, variant: Variant) {
  let crashed = false;

  page.on("crash", () => {
    crashed = true;
    log(variant.name, "crash event");
  });
  page.on("pageerror", (error) => log(variant.name, `pageerror ${error.message}`));

  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("load");
    log(variant.name, "loaded");
    await variant.prepare?.(page);

    if (variant.axe !== undefined) {
      const started = Date.now();
      const results = await variant.axe(page).analyze();

      log(
        variant.name,
        `axe done in ${Date.now() - started} ms, ${results.violations.length} violation(s)`,
      );
    }

    await page.waitForTimeout(1000);
    log(variant.name, crashed ? "crashed after axe" : "idle 1 s after axe, alive");
    await page.getByLabel("E-mail").click({ timeout: 5000 });
    log(variant.name, "clicked the e-mail field");
    await page.getByLabel("E-mail").fill("ada@example.com", { timeout: 5000 });
    log(variant.name, "filled the e-mail field");
  } catch (error) {
    log(variant.name, `stopped: ${error instanceof Error ? error.message.split("\n")[0] : "?"}`);
  }

  log(variant.name, crashed ? "RESULT crashed" : "RESULT alive");
}

for (const variant of VARIANTS) {
  test(`diag: sign-in, ${variant.name}`, async ({ browser, app }) => {
    const context = await browser.newContext({
      baseURL: app.baseURL,
      javaScriptEnabled: variant.javaScript ?? true,
    });

    const page = await context.newPage();

    try {
      await tryAxeThenTyping(page, variant);
    } finally {
      await context.close();
    }
  });
}
