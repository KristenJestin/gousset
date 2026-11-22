// TEMPORARY (#7): bisects Firefox's "Page crashed" on the sign-in page. Every variant passes; each
// prints what happened, for the CI log. Removed before the pull request is merged.
import type { Page } from "@playwright/test";

import { test } from "../src/test";

type Variant = {
  name: string;
  /** Changes the sign-in page's response before the browser reads it. */
  rewrite?: (body: string, headers: Record<string, string>) => [string, Record<string, string>];
  javaScript?: boolean;
  reducedMotion?: boolean;
};

const VARIANTS: Array<Variant> = [
  { name: "as served" },
  {
    name: "without the csp-nonce meta",
    rewrite: (body, headers) => [body.replace(/<meta property="csp-nonce"[^>]*>/, ""), headers],
  },
  {
    name: "without the Content-Security-Policy header",
    rewrite: (body, headers) => {
      const kept = { ...headers };

      delete kept["content-security-policy"];

      return [body, kept];
    },
  },
  { name: "without JavaScript", javaScript: false },
  { name: "under reduced motion", reducedMotion: true },
];

function log(variant: string, line: string) {
  // oxlint-disable-next-line no-console -- temporary diagnostics, read in the CI log
  console.log(`[diag-firefox] ${variant}: ${line}`);
}

async function tryTyping(page: Page, variant: string) {
  let crashed = false;

  page.on("crash", () => {
    crashed = true;
    log(variant, "crash event");
  });
  page.on("pageerror", (error) => log(variant, `pageerror ${error.message}`));
  page.on("console", (message) => log(variant, `console.${message.type()} ${message.text()}`));

  try {
    await page.goto("/sign-in");
    await page.waitForLoadState("load");
    log(variant, "loaded");
    await page.waitForTimeout(1500);
    log(variant, crashed ? "crashed while idle" : "idle 1.5 s, alive");
    await page.getByLabel("E-mail").click({ timeout: 5000 });
    log(variant, "clicked the e-mail field");
    await page.keyboard.type("a", { delay: 50 });
    log(variant, "typed one key");
    await page.getByLabel("E-mail").fill("ada@example.com", { timeout: 5000 });
    log(variant, "filled the e-mail field");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password", { timeout: 5000 });
    log(variant, "filled the password");
  } catch (error) {
    log(variant, `stopped: ${error instanceof Error ? error.message.split("\n")[0] : "?"}`);
  }

  log(variant, crashed ? "RESULT crashed" : "RESULT alive");
}

for (const variant of VARIANTS) {
  test(`diag: sign-in ${variant.name}`, async ({ browser, app }) => {
    const context = await browser.newContext({
      baseURL: app.baseURL,
      javaScriptEnabled: variant.javaScript ?? true,
      reducedMotion: variant.reducedMotion === true ? "reduce" : "no-preference",
    });

    const page = await context.newPage();
    const { rewrite } = variant;

    if (rewrite !== undefined) {
      await page.route("**/sign-in", async (route) => {
        const response = await route.fetch();
        const [body, headers] = rewrite(await response.text(), response.headers());

        await route.fulfill({ response, body, headers });
      });
    }

    try {
      await tryTyping(page, variant.name);
    } finally {
      await context.close();
    }
  });
}
