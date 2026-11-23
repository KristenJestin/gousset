import type { Page } from "@playwright/test";
import { category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { and, eq, isNull } from "drizzle-orm";

import type { TestUser } from "../src/auth";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { importsOn, statementFile } from "../src/imports";
import { openUserData } from "../src/user-data";

// Issue #23's pages: Settings › Categories and a line's category on the operations page, one test
// per scenario of "How to verify", plus their motion. The MCP scenarios are categories-mcp.spec.ts,
// the data's rules categories.spec.ts. Camille is this file's own user, with the default set in
// English; `fullyParallel` runs the tests in any order, so each one names its own categories and
// imports its own line, and only reads the default ones.

const TODAY = "2026-11-15";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let camille: TestUser;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
  camille = await addUser(app.baseURL, user, personOfItsOwn("camille"));
  owner = await data.ownerOf(camille.email);
});

test.afterAll(async () => {
  await data.close();
});

/** The page, signed in as Camille, on the fixed day. */
async function asCamille(page: Page, path: string) {
  await page.context().addCookies([...camille.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

/**
 * An expense line of its own, imported as the app imports it: in an account of its own, so that
 * its file is new, its entry in "Other". Its id.
 */
async function expenseLine(label: string): Promise<string> {
  const accountId = await imports.createAccount(owner, `Account of ${label}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: [{ bookedOn: "2026-10-12", amountMinor: -2450, label, reference: label.slice(-12) }],
    }),
  );

  const [line] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId)),
  );

  if (line === undefined) {
    throw new Error("The line was not imported.");
  }

  return line.id;
}

/** Puts a line's entry in the top-level expense category of that name, as a choice would. */
async function classify(lineId: string, name: string) {
  await data.asUser(owner, async (transaction) => {
    const [target] = await transaction
      .select({ id: category.id })
      .from(category)
      .where(and(eq(category.name, name), eq(category.kind, "expense"), isNull(category.parentId)));

    const [part] = await transaction
      .select({ entryId: entryPart.entryId })
      .from(entryPart)
      .where(eq(entryPart.lineId, lineId));

    if (target === undefined || part === undefined) {
      throw new Error(`No category ${name}, or no entry for the line.`);
    }

    await transaction
      .update(entry)
      .set({ categoryId: target.id })
      .where(eq(entry.id, part.entryId));
  });
}

const row = (page: Page, name: string) =>
  page.locator('[data-slot="category-row"]').filter({ hasText: new RegExp(`^${name}`) });

const menuOf = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Actions on ${name}`, exact: true }).click();
};

/** Adds a category through the page's dialog, under `parent` when given. */
async function addCategory(page: Page, name: string, parent?: string) {
  await page.getByRole("button", { name: "Add a category", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add a category" });

  await dialog.getByRole("textbox", { name: "Name" }).fill(name);

  if (parent !== undefined) {
    await dialog.getByRole("combobox", { name: "Under" }).click();
    await page.getByRole("option", { name: parent, exact: true }).click();
  }

  await dialog.getByRole("button", { name: "Add the category" }).click();
  await expect(dialog).toBeHidden();
}

/** The open line's category picker on the operations page. */
const linePicker = (page: Page) =>
  page.locator('[data-slot="line-category"]').getByRole("combobox", { name: "Category" });

test("creating a category and a child shows them on two levels", async ({ page }) => {
  await asCamille(page, "/settings/categories");

  await addCategory(page, "E2E Pets");
  await addCategory(page, "E2E Vet", "E2E Pets");

  await expect(row(page, "E2E Pets")).toBeVisible();
  await expect(row(page, "E2E Pets")).not.toHaveAttribute("data-child");
  await expect(row(page, "E2E Vet")).toHaveAttribute("data-child", "");
});

test("a third level is refused with its message", async ({ page }) => {
  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Garden");
  await addCategory(page, "E2E Seeds", "E2E Garden");

  // A category with a child cannot go under another: that would make a third level.
  await menuOf(page, "E2E Garden");
  await page.getByRole("menuitem", { name: "Move under…" }).click();

  const dialog = page.getByRole("dialog", { name: "Move E2E Garden" });

  await dialog.getByRole("combobox", { name: "Under" }).click();
  await page.getByRole("option", { name: "Housing", exact: true }).click();
  await dialog.getByRole("button", { name: "Move" }).click();

  await expect(dialog).toContainText(
    "Categories have two levels only: a category cannot go under a subcategory, and one with subcategories stays at the top level.",
  );
  await expect(dialog).toBeVisible();
});

test("renaming and moving a category change its row", async ({ page }) => {
  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Books");

  await menuOf(page, "E2E Books");
  await page.getByRole("menuitem", { name: "Rename" }).click();

  const rename = page.getByRole("dialog", { name: "Rename E2E Books" });

  await rename.getByRole("textbox", { name: "Name" }).fill("E2E Novels");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toBeHidden();
  await expect(row(page, "E2E Novels")).toBeVisible();

  await menuOf(page, "E2E Novels");
  await page.getByRole("menuitem", { name: "Move under…" }).click();

  const move = page.getByRole("dialog", { name: "Move E2E Novels" });

  await move.getByRole("combobox", { name: "Under" }).click();
  await page.getByRole("option", { name: "Leisure", exact: true }).click();
  await move.getByRole("button", { name: "Move" }).click();
  await expect(move).toBeHidden();
  await expect(row(page, "E2E Novels")).toHaveAttribute("data-child", "");
});

test("merging a category moves its lines to the target", async ({ page }) => {
  const lineId = await expenseLine("CB E2E MERGED SHOP");

  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Merged");
  await classify(lineId, "E2E Merged");
  await page.reload();
  await expect(row(page, "E2E Merged")).toContainText("1");

  await menuOf(page, "E2E Merged");
  await page.getByRole("menuitem", { name: "Merge with…" }).click();

  const dialog = page.getByRole("dialog", { name: "Merge E2E Merged" });

  await expect(dialog).toContainText("this is how a category is deleted");
  await dialog.getByRole("combobox", { name: "Into" }).pressSequentially("Groceries");
  await page.getByRole("option", { name: "Groceries", exact: true }).click();
  await dialog.getByRole("button", { name: "Merge" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "E2E Merged")).toHaveCount(0);

  // The line of the merged category now shows the target.
  await visit(page, `/operations?line=${lineId}`);
  await expect(linePicker(page)).toHaveValue("Groceries");
});

test("archiving keeps the history: the line keeps its category, listed with the archived", async ({
  page,
}) => {
  const lineId = await expenseLine("CB E2E ARCHIVED SHOP");

  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Old hobby");
  await classify(lineId, "E2E Old hobby");

  await menuOf(page, "E2E Old hobby");
  await page.getByRole("menuitem", { name: "Archive" }).click();

  const question = page.getByRole("alertdialog", { name: "Archive E2E Old hobby?" });

  await question.getByRole("button", { name: "Archive" }).click();
  await expect(question).toBeHidden();
  await expect(row(page, "E2E Old hobby")).toHaveCount(0);

  await page.getByRole("tab", { name: "Archived" }).click();
  await expect(row(page, "E2E Old hobby")).toBeVisible();

  await visit(page, `/operations?line=${lineId}`);
  await expect(linePicker(page)).toHaveValue("E2E Old hobby");
  await expect(
    page.locator('[data-slot="operation-row"]').filter({ hasText: "CB E2E ARCHIVED SHOP" }),
  ).toContainText("E2E Old hobby");
});

test("the fallback cannot be archived, and the page says why", async ({ page }) => {
  await asCamille(page, "/settings/categories");
  await menuOf(page, "Other");
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page
    .getByRole("alertdialog", { name: "Archive Other?" })
    .getByRole("button", { name: "Archive" })
    .click();

  await expect(
    page.getByText(
      "“Other” holds the lines not classified yet: it cannot be archived nor merged into another.",
    ),
  ).toBeVisible();
  await expect(row(page, "Other")).toBeVisible();
});

test("choosing a line's category from the operations page", async ({ page }) => {
  const lineId = await expenseLine("CB E2E CHOSEN SHOP");

  await asCamille(page, `/operations?line=${lineId}`);
  await expect(linePicker(page)).toHaveValue("Other");

  await linePicker(page).fill("");
  await linePicker(page).pressSequentially("supermar");
  await page.getByRole("option", { name: "Groceries › Supermarket" }).click();
  await expect(linePicker(page)).toHaveValue("Groceries › Supermarket");

  // The row says it too, and the choice is kept.
  const lineRow = page.locator('[data-slot="operation-row"]').filter({
    hasText: "CB E2E CHOSEN SHOP",
  });

  await expect(lineRow).toContainText("Groceries › Supermarket");
  await page.reload();
  await expect(linePicker(page)).toHaveValue("Groceries › Supermarket");
});

test("a fixed benchmark shows in its row", async ({ page }) => {
  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Coffee");

  await menuOf(page, "E2E Coffee");
  await page.getByRole("menuitem", { name: "Benchmark" }).click();

  const dialog = page.getByRole("dialog", { name: "Benchmark of E2E Coffee" });

  await dialog.getByRole("radio", { name: "Set" }).click();
  await dialog.getByRole("textbox", { name: "Amount per month" }).fill("130");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "E2E Coffee")).toContainText("set · €130.00");
});

test("a category just added slides in, and appears at once under reduced motion", async ({
  page,
}) => {
  await asCamille(page, "/settings/categories");
  await addCategory(page, "E2E Sliding");
  await expect(row(page, "E2E Sliding")).toHaveCSS("animation-duration", "0.2s");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await addCategory(page, "E2E Still");
  await expect(row(page, "E2E Still")).toHaveCSS("animation-duration", "0s");
});
