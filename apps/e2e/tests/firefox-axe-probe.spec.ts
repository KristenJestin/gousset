import AxeBuilder from "@axe-core/playwright";
import type { Browser } from "@playwright/test";
import { createRule } from "@gousset/core";
import { category } from "@gousset/db/schema/ledger";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// A probe, not a scenario, and removed once it has answered: Firefox's content process crashes
// (Playwright 1.65.1, "Page crashed") when axe runs at the end of rules.spec's correction
// scenario, on a phone, with a rule's side sheet open. apps/e2e/src/accessibility.ts already
// leaves out three WCAG rules that crash Firefox on ui-sdk's parts; this finds whether another one
// does here. Each rule runs alone on a fresh page brought to that state; the log says which crash.

const TODAY = "2026-11-15";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const RuleIds = Schema.Array(Schema.String);

/** apps/e2e/playwright.config.ts's phone width. */
const PHONE = { width: 390, height: 844 };

let data: ReturnType<typeof openUserData>;

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** A fresh page, signed in as `person`, on the rules with the first rule's sheet open. */
async function sheetOpen(browser: Browser, baseURL: string, person: TestUser) {
  // As the firefox-phone project's own pages are: Desktop Firefox at a phone's width.
  const context = await browser.newContext({
    baseURL,
    viewport: PHONE,
    locale: "en-US",
    timezoneId: "Europe/Paris",
  });

  const page = await context.newPage();

  await context.addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, "/settings/rules");
  await page.getByRole("button", { name: "label contains “PROBE CAFE”", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toContainText(
    "while correcting a line",
  );

  return { context, page };
}

/** Whether axe, with only `rules` (all of the level when empty), kills the page. */
async function crashes(
  browser: Browser,
  baseURL: string,
  person: TestUser,
  rules: ReadonlyArray<string>,
): Promise<string> {
  const { context, page } = await sheetOpen(browser, baseURL, person);

  try {
    const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);

    await (rules.length === 0 ? builder : builder.withRules([...rules])).analyze();
    // The documented crashes come at the next call to the page, not during axe.
    await page.evaluate("document.title");

    return "alive";
  } catch (error) {
    return error instanceof Error ? (error.message.split("\n")[0] ?? "error") : "error";
  } finally {
    await context.close().catch(() => undefined);
  }
}

test("probe: which axe rule crashes Firefox on an open rule sheet, on a phone", async ({
  app,
  user,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "firefox-phone", "Only Firefox on a phone crashes.");
  test.setTimeout(1_200_000);

  const person = await addUser(app.baseURL, user, personOfItsOwn("axe-probe"));
  const owner = await data.ownerOf(person.email);

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
        children: [{ kind: "rule", field: "label", operator: "contains", value: "PROBE CAFE" }],
      },
      merchantId: null,
      categoryId: leisure?.id ?? null,
      createdFrom: "correction",
    }).pipe(Effect.provide(data.layer)),
  );

  // Every rule of the level, read from axe once it is in a page.
  const { context, page } = await sheetOpen(browser, app.baseURL, person);

  const ids = Schema.decodeUnknownSync(RuleIds)(
    await page.evaluate(`axe.getRules(${JSON.stringify(WCAG_TAGS)}).map((rule) => rule.ruleId)`),
  );

  await context.close();

  const every = await crashes(browser, app.baseURL, person, []);
  const outcomes: Array<string> = [];

  for (const id of ids) {
    outcomes.push(`${id}: ${await crashes(browser, app.baseURL, person, [id])}`);
  }

  // The answer is in the failure: the whole level's outcome, and each rule that did not leave the
  // page alive.
  expect({
    every,
    rules: ids.length,
    killing: outcomes.filter((each) => !each.endsWith(": alive")),
  }).toEqual({ every: "alive", rules: ids.length, killing: [] });
});
