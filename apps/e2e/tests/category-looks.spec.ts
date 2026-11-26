import type { Page } from "@playwright/test";
import { category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { and, eq, isNull } from "drizzle-orm";

import type { TestUser } from "../src/auth";
import { downloadExport, readArchive } from "../src/export";
import { importsOn, statementFile } from "../src/imports";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #205: a category's colour and icon, chosen in Settings › Categories and shown wherever a
// category is named. One test per scenario of "How to verify" the browser can see; the palette's
// contrast is `packages/ui`'s unit test, the update of an existing user's defaults the upgrade
// check (tools/check-upgrade.sh), the MCP door's categories-mcp.spec.ts. Eden is this file's own
// user, with the default set in English; each test names its own categories.

const TODAY = "2026-11-15";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let eden: TestUser;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
  eden = await addUser(app.baseURL, user, personOfItsOwn("eden"));
  owner = await data.ownerOf(eden.email);
});

test.afterAll(async () => {
  await data.close();
});

/** The page, signed in as Eden, on the fixed day. */
async function asEden(page: Page, path: string) {
  await page.context().addCookies([...eden.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

/** An expense line of its own, of 24.50 € on 12 October, imported in an account of its own. */
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

/** A row's tile: its icon and its colour. */
const tileOf = (page: Page, name: string) => row(page, name).locator('[data-slot="category-icon"]');

/** Adds a category through the page's dialog, with a colour and an icon, under `parent` if given. */
async function addCategory(
  page: Page,
  name: string,
  look: { color?: string; icon?: string; parent?: string },
) {
  await page.getByRole("button", { name: "Add a category", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add a category" });

  await dialog.getByRole("textbox", { name: "Name" }).fill(name);

  if (look.parent !== undefined) {
    await dialog.getByRole("combobox", { name: "Under" }).click();
    await page.getByRole("option", { name: look.parent, exact: true }).click();
  }

  if (look.color !== undefined) {
    await dialog.getByRole("radio", { name: look.color, exact: true }).click();
  }

  if (look.icon !== undefined) {
    await dialog.getByRole("radio", { name: look.icon, exact: true }).click();
  }

  await dialog.getByRole("button", { name: "Add the category" }).click();
  await expect(dialog).toBeHidden();
}

test("choosing a colour and an icon shows them at once in the list and in a line's detail", async ({
  page,
}) => {
  const lineId = await expenseLine("CB E2E PLANT SHOP");

  await asEden(page, "/settings/categories");
  await addCategory(page, "E2E Plants", { color: "Teal", icon: "Garden" });
  await expect(tileOf(page, "E2E Plants")).toHaveAttribute("data-color", "teal");
  await expect(tileOf(page, "E2E Plants")).toHaveAttribute("data-icon", "garden");

  // Changed from the row's menu: the row shows it as soon as the dialog closes.
  await page.getByRole("button", { name: "Actions on E2E Plants", exact: true }).click();
  await page.getByRole("menuitem", { name: "Colour and icon" }).click();

  const dialog = page.getByRole("dialog", { name: "Colour and icon of E2E Plants" });

  await expect(dialog.getByRole("radio", { name: "Teal", exact: true })).toBeChecked();
  await dialog.getByRole("radio", { name: "Pink", exact: true }).click();
  await dialog.getByRole("radio", { name: "Gifts", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(tileOf(page, "E2E Plants")).toHaveAttribute("data-color", "pink");
  await expect(tileOf(page, "E2E Plants")).toHaveAttribute("data-icon", "gifts");

  // A line of it: its detail's category and its row show the icon, in the colour.
  await classify(lineId, "E2E Plants");
  await visit(page, `/operations?line=${lineId}`);

  const detail = page.locator('[data-slot="line-category"]');

  await expect(detail.getByRole("combobox", { name: "Category" })).toHaveValue("E2E Plants");
  await expect(detail.locator('[data-icon="gifts"][data-color="pink"]')).toBeVisible();

  const lineRow = page.locator('[data-slot="operation-row"]').filter({
    hasText: "CB E2E PLANT SHOP",
  });

  await expect(lineRow.locator('[data-slot="operation-category-icon"]')).toHaveAttribute(
    "data-color",
    "pink",
  );
});

test("a child without a colour of its own is shown in its parent's", async ({ page }) => {
  await asEden(page, "/settings/categories");
  await addCategory(page, "E2E Music", { color: "Indigo", icon: "Culture" });
  // No colour chosen: "As E2E Music", the first swatch, stays checked.
  await addCategory(page, "E2E Concerts", { parent: "E2E Music", icon: "Leisure" });

  await expect(tileOf(page, "E2E Concerts")).toHaveAttribute("data-color", "indigo");

  // The parent's colour changed, the child's follows.
  await page.getByRole("button", { name: "Actions on E2E Music", exact: true }).click();
  await page.getByRole("menuitem", { name: "Colour and icon" }).click();

  const dialog = page.getByRole("dialog", { name: "Colour and icon of E2E Music" });

  await dialog.getByRole("radio", { name: "Olive", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(tileOf(page, "E2E Concerts")).toHaveAttribute("data-color", "olive");
});

test("a new user's default categories come with their icons and colours", async ({ page }) => {
  await asEden(page, "/settings/categories");

  await expect(tileOf(page, "Housing")).toHaveAttribute("data-icon", "housing");
  await expect(tileOf(page, "Housing")).toHaveAttribute("data-color", "blue");
  // A child of the set has its own icon and its parent's colour.
  await expect(tileOf(page, "Rent")).toHaveAttribute("data-icon", "rent");
  await expect(tileOf(page, "Rent")).toHaveAttribute("data-color", "blue");
  await expect(tileOf(page, "Groceries")).toHaveAttribute("data-color", "green");

  await page.getByRole("tab", { name: "Income" }).click();
  await expect(tileOf(page, "Salary")).toHaveAttribute("data-icon", "salary");
  await expect(tileOf(page, "Salary")).toHaveAttribute("data-color", "green");
});

test("the review's breakdown draws a category's icon and bar in its colour", async ({ page }) => {
  const lineId = await expenseLine("CB E2E BREAKDOWN SHOP");

  await asEden(page, "/settings/categories");
  await addCategory(page, "E2E Garden centre", { color: "Amber", icon: "Garden" });
  await classify(lineId, "E2E Garden centre");

  await visit(page, "/?month=2026-10");

  // Eden's own October: a few categories, all shown.
  const spending = page.locator('[data-slot="breakdown"]').first();
  const garden = spending.locator("li").filter({ hasText: "E2E Garden centre" });

  await expect(garden.locator('[data-slot="breakdown-icon"]')).toHaveAttribute(
    "data-color",
    "amber",
  );
  await expect(garden.locator('[data-slot="breakdown-fill"]')).toHaveAttribute(
    "data-color",
    "amber",
  );
});

test("the export carries each category's colour and icon", async ({ app, page }) => {
  await asEden(page, "/settings/categories");
  await addCategory(page, "E2E Exported", { color: "Red", icon: "Pets" });

  const archive = readArchive(await downloadExport(app.baseURL, eden));
  const categories: unknown = JSON.parse(archive.text("categories.json"));

  expect(categories).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "E2E Exported", icon: "pets", color: "red" }),
      expect.objectContaining({ name: "Housing", icon: "housing", color: "blue" }),
    ]),
  );
});
