import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserType, Page } from "@playwright/test";
import { createRule } from "@gousset/core";
import { category } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { addUser, expect, fixDay, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// A probe, not a scenario, removed before the pull request is ready. The first probe showed that
// on a phone's width, Firefox's content process dies ("Page crashed") at the first axe scan of a
// rule's sheet, every time, the page idle; on a desktop's width it lives. This one names what kills
// it: whether an earlier scan (the list's, as `visit` runs it) is needed, which rule alone kills
// it, which rule alone run on the list before opening the sheet poisons the next scan, and which
// element of the sheet, scanned alone with every rule, does.

const TODAY = "2026-11-15";

/** As src/accessibility.ts has them. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const FIREFOX_CRASHING_RULES = [
  "label",
  "button-name",
  "label-content-name-mismatch",
  "aria-conditional-attr",
  "aria-prohibited-attr",
  "nested-interactive",
];

const ENTRANCES_DONE = `Promise.all(
  document
    .getAnimations()
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map((animation) => animation.finished.catch(() => undefined)),
).then(() => undefined)`;

/** Each element of the open sheet worth scanning alone: a path to it, and what it is. */
const SHEET_ELEMENTS = `(() => {
  const sheet = document.querySelector('[data-slot="drawer-content"]');
  if (!sheet) return [];
  const pathOf = (el) => {
    const steps = [];
    for (let at = el; at && at !== document.body; at = at.parentElement) {
      const index = Array.prototype.indexOf.call(at.parentElement.children, at) + 1;
      steps.unshift(at.tagName.toLowerCase() + ":nth-child(" + index + ")");
    }
    return "body > " + steps.join(" > ");
  };
  const worth = (el) => el.hasAttribute("data-slot") || el.hasAttribute("role") ||
    ["input", "button", "label", "form", "textarea", "select", "fieldset", "legend"].includes(el.tagName.toLowerCase());
  return [sheet, ...sheet.querySelectorAll("*")].filter(worth).slice(0, 90).map((el) => ({
    selector: pathOf(el),
    what: el.tagName.toLowerCase() +
      (el.getAttribute("data-slot") ? "[" + el.getAttribute("data-slot") + "]" : "") +
      (el.getAttribute("role") ? "(" + el.getAttribute("role") + ")" : "") +
      (el.getAttribute("type") ? "{" + el.getAttribute("type") + "}" : "") +
      " " + (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
  }));
})()`;

const SheetElements = Schema.Array(Schema.Struct({ selector: Schema.String, what: Schema.String }));

const PHONE = { width: 390, height: 844 };

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the probe's own, with one line and a rule made beside the page. */
async function personWithRule(
  app: { baseURL: string },
  admin: TestUser,
  local: string,
  word: string,
): Promise<TestUser> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);
  const accountId = await imports.createAccount(owner, `Account of ${word}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: [
        {
          bookedOn: "2026-10-01",
          amountMinor: -1250,
          label: `CB E2E ${word} CAFE 01/10`,
          reference: "E2E-PROBE-0",
        },
      ],
    }),
  );

  const [leisure] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id })
      .from(category)
      .where(
        and(eq(category.name, "Leisure"), eq(category.kind, "expense"), isNull(category.parentId)),
      ),
  );

  await Effect.runPromise(
    createRule(owner, {
      conditions: {
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "label", operator: "contains", value: `${word} CAFE` }],
      },
      merchantId: null,
      categoryId: leisure?.id ?? "",
      createdFrom: "correction",
    }).pipe(Effect.provide(data.layer)),
  );

  return person;
}

type Before = "none" | "all" | { rule: string };

/**
 * A page of its own, on the rules' list, scanned first as `before` says (as `visit` does, or with
 * one rule, or not at all), then the rule's sheet opened and its entrance ended.
 */
async function sheetOpen(
  browser: Browser,
  baseURL: string,
  person: TestUser,
  word: string,
  before: Before,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: PHONE,
    locale: "en-US",
    timezoneId: "Europe/Paris",
  });

  await context.addCookies([...person.cookies]);

  const page = await context.newPage();

  page.setDefaultTimeout(15_000);
  await fixDay(page, TODAY);
  await page.goto("/settings/rules");
  await page.waitForLoadState("load");
  await page.evaluate(ENTRANCES_DONE);

  if (before === "all") {
    await everyRule(page).analyze();
  } else if (before !== "none") {
    await new AxeBuilder({ page }).withRules([before.rule]).analyze();
  }

  await page.getByRole("button", { name: `label contains “${word} CAFE”`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toContainText(
    "while correcting a line",
  );
  await page.evaluate(ENTRANCES_DONE);

  return page;
}

/** The scan `expectAccessible` runs in Firefox. */
function everyRule(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS).disableRules(FIREFOX_CRASHING_RULES);
}

function isCrash(error: Error): boolean {
  return /crash|closed|Target/i.test(error.message);
}

/** Firefox, launched again when a crash took it down. */
class Firefox {
  private browser: Browser | undefined;

  constructor(private readonly type: BrowserType) {}

  async get(): Promise<Browser> {
    if (this.browser === undefined || !this.browser.isConnected()) {
      this.browser = await this.type.launch();
    }

    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }
}

/** Every rule of the WCAG tags, crashing ones included, as axe lists them on a blank page. */
async function wcagRules(firefox: Firefox): Promise<Array<string>> {
  const context = await (await firefox.get()).newContext();
  const page = await context.newPage();

  await page.setContent('<html lang="en"><head><title>x</title></head><main>x</main></html>');

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  await context.close();

  return [...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable]
    .map((result) => result.id)
    .toSorted();
}

/** One attempt in a page of its own: whether it lived. A crash relaunches the browser. */
async function attempt(
  firefox: Firefox,
  open: (browser: Browser) => Promise<Page>,
  scan: (page: Page) => AxeBuilder,
): Promise<string> {
  let step = "open";

  try {
    const page = await open(await firefox.get());

    step = "scan";
    await scan(page).analyze();
    step = "after";
    await page.evaluate("document.title");
    await page.context().close();

    return "alive";
  } catch (error) {
    if (!(error instanceof Error) || !isCrash(error)) {
      throw error;
    }

    await firefox.close();

    return `CRASHED in ${step}`;
  }
}

function probe(
  name: string,
  body: (
    firefox: Firefox,
    open: (browser: Browser, before: Before) => Promise<Page>,
    report: Array<string>,
  ) => Promise<void>,
  index: number,
) {
  test(`probe: ${name}`, async ({ app, user, playwright }, testInfo) => {
    test.skip(testInfo.project.name !== "firefox-phone", "Firefox on a phone only.");
    test.setTimeout(1_200_000);

    const word = ["ALDER", "BIRCH", "CEDAR", "DAPHNE", "ELDER"][index] ?? "FIR";
    const person = await personWithRule(app, user, `probe-${index}`, word);
    const firefox = new Firefox(playwright.firefox);
    const report: Array<string> = [];

    try {
      await body(
        firefox,
        (browser, before) => sheetOpen(browser, app.baseURL, person, word, before),
        report,
      );
    } catch (error) {
      report.push(`FAILED: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : "?"}`);
    } finally {
      await firefox.close();
    }

    // The answer is in the failure: a probe's report is read in CI's log, which prints errors.
    throw new Error(`PROBE ${name}\n${report.join("\n")}`);
  });
}

probe(
  "an earlier scan",
  async (firefox, open, report) => {
    for (let round = 1; round <= 3; round++) {
      const none = await attempt(firefox, (browser) => open(browser, "none"), everyRule);
      const all = await attempt(firefox, (browser) => open(browser, "all"), everyRule);

      report.push(`round ${round}: no earlier scan ${none}; after the list's scan ${all}`);
    }
  },
  0,
);

probe(
  "each rule alone on the sheet, after the list's scan",
  async (firefox, open, report) => {
    const crashed: Array<string> = [];
    const rules = await wcagRules(firefox);

    for (const rule of rules) {
      const result = await attempt(
        firefox,
        (browser) => open(browser, "all"),
        (page) => new AxeBuilder({ page }).withRules([rule]),
      );

      if (result !== "alive") {
        crashed.push(`${rule} (${result})`);
      }
    }

    report.push(`${rules.length} rules, crashed alone: ${crashed.join(" ") || "none"}`);
  },
  1,
);

probe(
  "each rule alone on the list, then every rule on the sheet",
  async (firefox, open, report) => {
    const crashed: Array<string> = [];
    const rules = await wcagRules(firefox);

    for (const rule of rules) {
      const result = await attempt(firefox, (browser) => open(browser, { rule }), everyRule);

      if (result !== "alive") {
        crashed.push(`${rule} (${result})`);
      }
    }

    report.push(`${rules.length} rules, crashed after: ${crashed.join(" ") || "none"}`);

    const none = await attempt(firefox, (browser) => open(browser, "none"), everyRule);

    report.push(`no earlier scan: ${none}`);
  },
  2,
);

probe(
  "each element of the sheet, every rule",
  async (firefox, open, report) => {
    const first = await open(await firefox.get(), "all");
    const elements = Schema.decodeUnknownSync(SheetElements)(await first.evaluate(SHEET_ELEMENTS));

    await first.context().close();

    const crashed: Array<string> = [];

    for (const element of elements) {
      const result = await attempt(
        firefox,
        (browser) => open(browser, "all"),
        (page) => everyRule(page).include(element.selector),
      );

      if (result !== "alive") {
        crashed.push(`${element.what} (${result}) @ ${element.selector}`);
      }
    }

    const outside = await attempt(
      firefox,
      (browser) => open(browser, "all"),
      (page) => everyRule(page).exclude('[data-slot="drawer-content"]'),
    );

    report.push(`${elements.length} elements; outside the sheet: ${outside}; crashed:`, ...crashed);
  },
  3,
);
