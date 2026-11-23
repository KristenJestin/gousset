import type { Page } from "@playwright/test";
import { exampleStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import {
  addUser,
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #24's merchants page, "How to verify", in the browser: a statement whose lines name the
// same invented shop under several labels is imported as the import job runs it, then the
// settings' Merchants section shows one merchant for them, which the user renames, splits and
// merges back. The MCP scenario is merchants-mcp.spec.ts. Each test has a user of its own
// (`personOfItsOwn`), so that its merchants meet no other test's, whatever order they run in.

const TODAY = "2026-11-15";

/**
 * One invented shop under three raw labels, which clean to QUILLBROOK, QUILLBROOK RIVERTON and
 * QUILLBROOK MARKET HALL, and another shop. CSV days after the 12th, so the file says which comes
 * first.
 */
const QUILLBROOK_LABELS = [
  "CB QUILLBROOK 2110 RIVERTON",
  "PAIEMENT PAR CARTE X4821 QUILLBROOK RIVERTON 24/10",
  "CONTACTLESS QUILLBROOK MARKET HALL GB",
] as const;

const LANTERNFIELD_LABEL = "CB LANTERNFIELD 2610 RIVERTON";

const statement: Statement = {
  ...exampleStatement,
  from: "2026-10-01",
  to: "2026-10-31",
  lines: [
    {
      bookedOn: "2026-10-21",
      amountMinor: -2318,
      label: QUILLBROOK_LABELS[0],
      reference: "QB21",
    },
    {
      bookedOn: "2026-10-24",
      amountMinor: -4105,
      label: QUILLBROOK_LABELS[1],
      reference: "QB24",
    },
    {
      bookedOn: "2026-10-27",
      amountMinor: -999,
      label: QUILLBROOK_LABELS[2],
      reference: "QB27",
    },
    {
      bookedOn: "2026-10-28",
      amountMinor: -1250,
      label: LANTERNFIELD_LABEL,
      reference: "LF28",
    },
  ],
};

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, with the statement imported into an account of theirs. */
async function shopper(baseURL: string, admin: TestUser, local: string): Promise<TestUser> {
  const person = await addUser(baseURL, admin, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);
  const accountId = await imports.createAccount(owner, "Everyday");

  const imported = await imports.importFile(
    owner,
    accountId,
    statementFile("csv", statement, "riverton-2026-10.csv"),
  );

  expect(imported.status).toBe("done");

  return person;
}

/** The page, signed in as `person`, on the fixed day. */
async function signedInAs(page: Page, person: TestUser) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const merchantList = (page: Page) => page.getByRole("list", { name: "Merchants" });

/** A merchant's row in the list: its name first, then how many labels name it. */
const merchantRow = (page: Page, name: string) =>
  merchantList(page).getByRole("link", { name: new RegExp(`^${name} \\d+ labels?`) });

const labelList = (page: Page) => page.getByRole("list", { name: "Labels" });

/** The row of the label QUILLBROOK alone: its text, then its Move button's. */
const ALONE = /^QUILLBROOK\s*Move$/;

/** A block of the merchant's page, by its heading. */
const block = (page: Page, title: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: title }) });

/** Opens a merchant's page from the settings' Merchants section. */
async function openMerchant(page: Page, name: string) {
  await visit(page, "/settings");
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("link", { name: "Merchants" })
    .click();
  await merchantRow(page, name).click();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
}

test("the same shop under several labels becomes one merchant", async ({ page, app, user }) => {
  const quentin = await shopper(app.baseURL, user, "quentin.merchants");

  await signedInAs(page, quentin);
  await openMerchant(page, "Quillbrook");

  // One merchant for the three labels, and another for the other shop.
  await page.getByRole("link", { name: "All merchants" }).click();
  await expect(merchantList(page).getByRole("link")).toHaveCount(2);
  await expect(merchantRow(page, "Quillbrook")).toContainText("3 labels");
  await expect(merchantRow(page, "Lanternfield")).toContainText("1 label");

  // A label finds its merchant, as a name does.
  await page.getByRole("searchbox", { name: "Search the merchants" }).fill("riverton");
  await expect(merchantList(page).getByRole("link")).toHaveCount(1);
  await expect(page.getByText("1 merchant", { exact: true })).toBeVisible();
  await merchantRow(page, "Quillbrook").click();

  await expect(labelList(page).getByRole("listitem")).toHaveText([
    ALONE,
    /^QUILLBROOK MARKET HALL/,
    /^QUILLBROOK RIVERTON/,
  ]);

  // Its latest lines, newest first, each with its account and amount.
  const lines = block(page, "Latest lines").getByRole("listitem");

  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText(QUILLBROOK_LABELS[2]);
  await expect(lines.nth(0)).toContainText("Everyday");
  await expect(lines.nth(0)).toContainText("9.99");
  await expect(lines.nth(2)).toContainText(QUILLBROOK_LABELS[0]);
  await animationsDone(page);
});

test("renaming a merchant shows its new name; a name another merchant has says to merge", async ({
  page,
  app,
  user,
}) => {
  const romy = await shopper(app.baseURL, user, "romy.merchants");

  await signedInAs(page, romy);
  await openMerchant(page, "Quillbrook");
  await page.getByRole("button", { name: "Rename", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Rename Quillbrook" });
  const name = dialog.getByRole("textbox", { name: "Name" });

  // The other shop's name, in another case: refused in the form, which stays open.
  await name.fill("lanternfield");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(name).toHaveAccessibleDescription(
    "Lanternfield already has this name: merge this merchant into it instead.",
  );
  await expect(dialog).toBeVisible();

  await name.fill("   ");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(name).toHaveAccessibleDescription("Give the merchant a name.");

  await name.fill("Quillbrook Grocer");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog).toBeHidden();
  // The toast's own text; the announcer repeats it after "Saved." for screen readers.
  await expect(
    page.getByText("Quillbrook is now Quillbrook Grocer.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Quillbrook Grocer", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "All merchants" }).click();
  await expect(merchantRow(page, "Quillbrook Grocer")).toBeVisible();
  await expect(merchantRow(page, "Quillbrook")).toHaveCount(0);
  await animationsDone(page);
});

test("moving a label to a new name splits the merchant", async ({ page, app, user }) => {
  const solene = await shopper(app.baseURL, user, "solene.merchants");

  await signedInAs(page, solene);
  await openMerchant(page, "Quillbrook");
  await page
    .getByRole("button", { name: "Move QUILLBROOK MARKET HALL to another merchant" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Move QUILLBROOK MARKET HALL" });

  // The controls of this page's dialogs are new to the app: checked with one open.
  await expectAccessible(page);

  await dialog
    .getByRole("combobox", { name: "To the merchant" })
    .pressSequentially("Quillbrook Market Hall");
  await dialog.getByRole("button", { name: "Move the label" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("QUILLBROOK MARKET HALL now names Quillbrook Market Hall, a new merchant.", {
      exact: true,
    }),
  ).toBeVisible();

  // The merchant keeps its other labels, and the lines of the one moved left with it.
  await expect(labelList(page).getByRole("listitem")).toHaveText([ALONE, /^QUILLBROOK RIVERTON/]);
  await expect(block(page, "Latest lines").getByRole("listitem")).toHaveCount(2);

  await page.getByRole("link", { name: "All merchants" }).click();
  await expect(merchantRow(page, "Quillbrook")).toContainText("2 labels");
  await merchantRow(page, "Quillbrook Market Hall").click();
  await expect(labelList(page).getByRole("listitem")).toHaveText([/^QUILLBROOK MARKET HALL/]);
  await expect(block(page, "Latest lines")).toContainText(QUILLBROOK_LABELS[2]);
  await animationsDone(page);
});

test("merging a merchant into another gathers their labels, and the merged one is gone", async ({
  page,
  app,
  user,
}) => {
  const tobias = await shopper(app.baseURL, user, "tobias.merchants");

  await signedInAs(page, tobias);

  // Split first, as the user would, then merged back.
  await openMerchant(page, "Quillbrook");
  await page
    .getByRole("button", { name: "Move QUILLBROOK MARKET HALL to another merchant" })
    .click();

  const move = page.getByRole("dialog", { name: "Move QUILLBROOK MARKET HALL" });

  await move.getByRole("combobox", { name: "To the merchant" }).pressSequentially("Hall Stall");
  await move.getByRole("button", { name: "Move the label" }).click();
  await expect(move).toBeHidden();

  await page.getByRole("link", { name: "All merchants" }).click();
  await merchantRow(page, "Hall Stall").click();
  await page.getByRole("button", { name: "Merge into…" }).click();

  const dialog = page.getByRole("dialog", { name: "Merge Hall Stall into another merchant" });

  await expect(dialog).toContainText("Hall Stall disappears: its labels move to the merchant kept");

  const into = dialog.getByRole("combobox", { name: "Merchant kept" });

  // A name no merchant has is refused in the form.
  await into.fill("Nowhere Shop");
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(into).toHaveAccessibleDescription(
    "No merchant has this name: choose one of those offered.",
  );

  // The merchant kept, chosen among those offered.
  await into.fill("");
  await into.pressSequentially("quill");
  await page.getByRole("option", { name: "Quillbrook", exact: true }).click();
  await expect(into).toHaveValue("Quillbrook");
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Hall Stall is merged into Quillbrook.", { exact: true }),
  ).toBeVisible();

  // The page of the merchant kept, with every label again.
  await expect(
    page.getByRole("heading", { level: 2, name: "Quillbrook", exact: true }),
  ).toBeVisible();
  await expect(labelList(page).getByRole("listitem")).toHaveText([
    ALONE,
    /^QUILLBROOK MARKET HALL/,
    /^QUILLBROOK RIVERTON/,
  ]);

  await page.getByRole("link", { name: "All merchants" }).click();
  await expect(merchantRow(page, "Quillbrook")).toContainText("3 labels");
  await expect(merchantRow(page, "Hall Stall")).toHaveCount(0);
  await animationsDone(page);
});

test("with no import yet, the merchants section says they come from imports", async ({
  page,
  app,
  user,
}) => {
  const ulysse = await addUser(app.baseURL, user, personOfItsOwn("ulysse.merchants"));

  await signedInAs(page, ulysse);
  await visit(page, "/settings/merchants");
  await expect(page.getByText("No merchant yet")).toBeVisible();
  await expect(page.getByText(/Merchants come from your imports/)).toBeVisible();
  await animationsDone(page);
});

test("choosing a merchant's default category in its page shows it there; None clears it", async ({
  page,
  app,
  user,
}) => {
  const wanda = await shopper(app.baseURL, user, "wanda.merchants");

  await signedInAs(page, wanda);
  await openMerchant(page, "Quillbrook");

  const chosen = block(page, "Default category").getByRole("listitem");

  await expect(chosen).toContainText("None");

  const change = page.getByRole("button", { name: "Change the default category of Quillbrook" });

  await change.click();

  const dialog = page.getByRole("dialog", { name: "Default category of Quillbrook" });

  // Expense is offered first: its categories in use, found by typing.
  await expect(dialog.getByRole("radio", { name: "Expense" })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Category" }).pressSequentially("Bakery");
  await page.getByRole("option", { name: "Groceries › Bakery", exact: true }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("The default category of Quillbrook is now Groceries › Bakery.").first(),
  ).toBeVisible();
  await expect(chosen).toContainText("Groceries › Bakery");
  await expect(chosen).toContainText("Expense");

  // The page read again shows it, from the database.
  await page.reload();
  await expect(block(page, "Default category").getByRole("listitem")).toContainText(
    "Groceries › Bakery",
  );

  await change.click();
  await dialog.getByRole("radio", { name: "None" }).click();
  await expect(dialog.getByRole("combobox", { name: "Category" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(chosen).toContainText("None");
  await expectAccessible(page);
  await animationsDone(page);
});

test("a merchant's dialog fades and grows in 200 ms, and appears at once under reduced motion", async ({
  page,
  app,
  user,
}) => {
  const vera = await shopper(app.baseURL, user, "vera.merchants");

  await signedInAs(page, vera);
  await openMerchant(page, "Lanternfield");
  await page.getByRole("button", { name: "Rename", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Rename Lanternfield" });

  await expect(dialog).toHaveCSS("transition-duration", "0.2s");
  await expect(dialog).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
