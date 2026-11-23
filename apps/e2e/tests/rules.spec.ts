import type { Page } from "@playwright/test";
import { createRule } from "@gousset/core";
import { category, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #25's screens: Settings › Rules and the rule a correction proposes on the operations page,
// one test per scenario of "How to verify", plus their motion. The MCP scenarios are
// rules-mcp.spec.ts. Each test has a user of its own: the rules' list and order are the user's
// alone, and `fullyParallel` runs the tests in any order. Every label here is made up.

const TODAY = "2026-11-15";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, and its owner id for the rows made beside the pages. */
async function personFor(
  app: { baseURL: string },
  admin: TestUser,
  local: string,
): Promise<{ person: TestUser; owner: string }> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return { person, owner: await data.ownerOf(person.email) };
}

/** The page, signed in as `person`, on the fixed day. */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

/**
 * Expense lines of their own, imported as the app imports them, in an account of their own: each
 * entry in "Other", classified by default. Their ids, in the order given.
 */
async function expenseLines(owner: string, labels: ReadonlyArray<string>): Promise<Array<string>> {
  const accountId = await imports.createAccount(owner, `Account of ${labels[0] ?? "lines"}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: labels.map((label, index) => ({
        bookedOn: `2026-10-${String(index + 1).padStart(2, "0")}`,
        amountMinor: -1250 - index * 100,
        label,
        reference: `E2E-RULE-${index}`,
      })),
    }),
  );

  const lines = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, label: statementLine.label })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn)),
  );

  return labels.map((label) => {
    const found = lines.find((line) => line.label === label);

    if (found === undefined) {
      throw new Error(`The line ${label} was not imported.`);
    }

    return found.id;
  });
}

/** The id of the user's top-level expense category of that name. */
async function expenseCategory(owner: string, name: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.name, name), eq(category.kind, "expense"), isNull(category.parentId))),
  );

  if (found === undefined) {
    throw new Error(`No expense category ${name}.`);
  }

  return found.id;
}

/** A rule "label contains `text`" into the category of that name, made as the app makes one. */
async function labelRule(owner: string, text: string, categoryName: string) {
  await Effect.runPromise(
    createRule(owner, {
      conditions: {
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "label", operator: "contains", value: text }],
      },
      merchantId: null,
      categoryId: await expenseCategory(owner, categoryName),
      createdFrom: "user",
    }).pipe(Effect.provide(data.layer)),
  );
}

const rows = (page: Page) => page.locator('[data-slot="rule-row"]');

/** The rule whose conditions read as `sentence`, as the list says it. */
const ruleNamed = (page: Page, sentence: string) =>
  page.getByRole("button", { name: sentence, exact: true });

/** The open line's category picker on the operations page. */
const linePicker = (page: Page) =>
  page.locator('[data-slot="line-category"]').getByRole("combobox", { name: "Category" });

const operationRow = (page: Page, label: string) =>
  page.locator('[data-slot="operation-row"]').filter({ hasText: label });

test("creating a rule from its screen", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "rules-create");

  await expenseLines(owner, ["CB E2E OAKLEAF 02/10"]);
  await as(page, person, "/settings/rules");

  await expect(page.getByText("No rule yet")).toBeVisible();
  await page.getByRole("button", { name: "Add a rule" }).click();

  const sheet = page.getByRole("dialog", { name: "New rule" });

  await sheet.getByRole("textbox", { name: "Value of condition 1" }).fill("E2E OAKLEAF");
  await sheet
    .getByRole("combobox", { name: "Category", exact: true })
    .pressSequentially("Groceries");
  await page.getByRole("option", { name: "Groceries", exact: true }).click();

  // Its effect, read before saving: the line already there, which it offers to classify too.
  await expect(sheet.locator('[data-slot="rule-reach"]')).toHaveText("Applies to 1 existing line.");

  const apply = sheet.getByRole("checkbox", { name: "Also apply to the 1 line already there" });

  await expect(apply).toBeChecked();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  await expect(ruleNamed(page, "label contains “E2E OAKLEAF”")).toBeVisible();
  await expect(rows(page)).toContainText("Groceries");
  await expect(page.getByText("1 line changed")).toBeVisible();
  // The job's end reads the list again: the rule classified one line.
  await expect(rows(page)).toContainText("1 time");
});

test("a correction proposes a rule, which classifies the line's look-alikes when applied to the past", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "rules-proposal");

  const [first] = await expenseLines(owner, [
    "CB E2E BRAMBLE CAFE 01/10",
    "CB E2E BRAMBLE CAFE 08/10",
    "CB E2E BRAMBLE CAFE 15/10",
  ]);

  await as(page, person, `/operations?line=${first}`);
  await expect(linePicker(page)).toHaveValue("Other");
  await linePicker(page).fill("");
  await linePicker(page).pressSequentially("Leisure");
  await page.getByRole("option", { name: "Leisure", exact: true }).click();

  const proposal = page.getByRole("dialog", { name: "Make it a rule?" });

  // The label's merchant, as merchantKey cleans it: the payment word and the date dropped, and
  // "E2E" too, a word of letters and digits being read as a reference. The look-alikes hold it.
  await expect(proposal.getByRole("textbox", { name: "Label contains" })).toHaveValue(
    "BRAMBLE CAFE",
  );

  const apply = proposal.getByRole("checkbox", {
    name: "Also apply to the 2 lines already there",
  });

  await expect(apply).toBeChecked();
  await proposal.getByRole("button", { name: "Create the rule" }).click();
  await expect(proposal).toBeHidden();

  // The job says how many lines it changed, and the look-alikes are in the category chosen.
  await expect(page.getByText("2 lines changed")).toBeVisible();
  await expect(operationRow(page, "CB E2E BRAMBLE CAFE 08/10")).toContainText("Leisure");
  await expect(operationRow(page, "CB E2E BRAMBLE CAFE 15/10")).toContainText("Leisure");

  // The rule is on the rules' screen, born from the correction.
  await visit(page, "/settings/rules");
  await ruleNamed(page, "label contains “BRAMBLE CAFE”").click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toContainText(
    "while correcting a line",
  );
});

test("dismissing the proposal changes nothing", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "rules-dismissed");

  const [first] = await expenseLines(owner, [
    "CB E2E TINKER BOOKS 03/10",
    "CB E2E TINKER BOOKS 09/10",
  ]);

  await as(page, person, `/operations?line=${first}`);
  await linePicker(page).fill("");
  await linePicker(page).pressSequentially("Leisure");
  await page.getByRole("option", { name: "Leisure", exact: true }).click();

  const proposal = page.getByRole("dialog", { name: "Make it a rule?" });

  await proposal.getByRole("button", { name: "Cancel" }).click();
  await expect(proposal).toBeHidden();
  await expect(operationRow(page, "CB E2E TINKER BOOKS 09/10")).toContainText("Other");

  await visit(page, "/settings/rules");
  await expect(page.getByText("No rule yet")).toBeVisible();
});

test("editing, turning off, reordering and deleting rules", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "rules-edit");

  await labelRule(owner, "E2E FIRST", "Groceries");
  await labelRule(owner, "E2E SECOND", "Leisure");
  await as(page, person, "/settings/rules");
  await expect(rows(page)).toHaveCount(2);

  // Edit: its label condition.
  await ruleNamed(page, "label contains “E2E FIRST”").click();

  const first = page.getByRole("dialog", { name: "Rule 1" });

  await first.getByRole("textbox", { name: "Value of condition 1" }).fill("E2E FIRSTLY");
  await first.getByRole("button", { name: "Save" }).click();
  await expect(first).toBeHidden();
  await expect(ruleNamed(page, "label contains “E2E FIRSTLY”")).toBeVisible();

  // Turn off: kept in its place, said "Off".
  await ruleNamed(page, "label contains “E2E FIRSTLY”").click();
  await page.getByRole("dialog", { name: "Rule 1" }).getByRole("switch", { name: "On" }).click();
  await page.getByRole("dialog", { name: "Rule 1" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: "Rule 1" })).toBeHidden();
  await expect(rows(page).first()).toHaveAttribute("data-enabled", "false");
  await expect(rows(page).first()).toContainText("Off");

  // Reorder: the second is tried first.
  await page.getByRole("button", { name: "Move rule 2 up" }).click();
  await expect(rows(page).first()).toContainText("E2E SECOND");
  await page.reload();
  await expect(rows(page).first()).toContainText("E2E SECOND");

  // Delete, once confirmed.
  await ruleNamed(page, "label contains “E2E SECOND”").click();
  await page
    .getByRole("dialog", { name: "Rule 1" })
    .getByRole("button", { name: "Delete" })
    .click();

  const question = page.getByRole("alertdialog", { name: "Delete this rule?" });

  await question.getByRole("button", { name: "Delete" }).click();
  await expect(question).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await expect(ruleNamed(page, "label contains “E2E SECOND”")).toHaveCount(0);
});

test("the rules move in 200 ms, and not under reduced motion", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "rules-motion");

  await labelRule(owner, "E2E MOVING", "Groceries");
  await labelRule(owner, "E2E STILL", "Leisure");
  await as(page, person, "/settings/rules");

  // A row fades in on first paint, a rule moved slides in from where it was: 200 ms each.
  await expect(rows(page).first()).toHaveCSS("animation-duration", "0.2s");
  await page.getByRole("button", { name: "Move rule 2 up" }).click();
  await expect(rows(page).first()).toContainText("E2E STILL");
  await expect(rows(page).first()).toHaveCSS("animation-duration", "0.2s");

  // Delete's question grows in 200 ms.
  await ruleNamed(page, "label contains “E2E STILL”").click();
  await page
    .getByRole("dialog", { name: "Rule 1" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByRole("alertdialog", { name: "Delete this rule?" })).toHaveCSS(
    "transition-duration",
    "0.2s",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("alertdialog", { name: "Delete this rule?" })).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Move rule 2 up" }).click();
  await expect(rows(page).first()).toContainText("E2E MOVING");
  await expect(rows(page).first()).toHaveCSS("animation-duration", "0s");
});
