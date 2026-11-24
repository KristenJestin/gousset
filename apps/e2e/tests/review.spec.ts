import { exampleStatement } from "@gousset/fixture";
import type { Page } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/client";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { addUser, connectMcp, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// The scenarios of issue #126, "How to verify": until the review reads the user's own lines (v0.4),
// a fresh user and a user with imported lines both see its empty state, and no invented name or
// figure appears in the app or in MCP results. Each user is the file's own (`personOfItsOwn`):
// Inès has nothing; Romane has one account and one statement imported through the real import.

const TODAY = "2026-11-15";

/**
 * Names of the made-up household the review used to show (packages/fixture's ledger): none may
 * appear for any user. Romane's own lines come from another made-up statement, with other names.
 */
const INVENTED = ["Acme Consulting", "MealCard", "Northbank", "Streamly", "Groceries", "Housing"];

let data: ReturnType<typeof openUserData>;
let ines: TestUser;
let romane: TestUser;

/** What Romane's import added: her counted lines, and those held for review. */
let imported = { added: 0, held: 0 };

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  ines = await addUser(app.baseURL, user, personOfItsOwn("ines"));
  romane = await addUser(app.baseURL, user, personOfItsOwn("romane"));

  const owner = await data.ownerOf(romane.email);
  const imports = importsOn(data);
  const accountId = await imports.createAccount(owner, "Everyday account");

  const summary = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", exampleStatement),
  );

  imported = { added: summary.linesAdded, held: summary.linesHeld };
});

test.afterAll(async () => {
  await data.close();
});

async function signedInAs(page: Page, person: TestUser) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const emptyState = (page: Page) => page.locator('[data-slot="review-coming"]');

const worksToday = (page: Page) => page.getByRole("list", { name: "What works today" });

/** The review shows no figure and none of the made-up household's names. */
async function expectNothingInvented(page: Page) {
  const main = page.getByRole("main");

  for (const name of INVENTED) {
    await expect(main.getByText(name)).toHaveCount(0);
  }

  await expect(main).not.toContainText("€");
  await expect(main).not.toContainText("Made-up data");
}

/** A month call's text, and whether it is an error. */
async function month(client: Client, args: { [key: string]: string }) {
  const result = await client.callTool({ name: "month", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

test("a fresh user sees the empty state, the first import first", async ({ page }) => {
  await signedInAs(page, ines);
  await visit(page, "/");

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  await expect(
    emptyState(page).getByRole("heading", { name: "Your monthly review is not ready yet" }),
  ).toBeVisible();
  await expect(emptyState(page)).toContainText("nothing here is invented");

  // The four parts the review will hold, in words only: no chart, no skeleton.
  const parts = page.getByRole("definition");

  await expect(page.getByRole("term")).toHaveText(["Income", "Spent", "Set aside", "Left"]);
  await expect(parts).toHaveCount(4);
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

  // What works today: the first import first, then the accounts and the operations, none yet.
  const links = worksToday(page).getByRole("link");

  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toContainText("Import your first statement");
  await expect(links.nth(0)).toHaveAttribute("href", "/import");
  await expect(links.nth(1)).toContainText("Accounts");
  await expect(links.nth(1)).toContainText("None yet");
  await expect(links.nth(2)).toContainText("Operations");
  await expect(links.nth(2)).toContainText("None yet");

  await expectNothingInvented(page);

  await links.nth(0).click();
  await expect(page).toHaveURL(/\/import$/);
});

test("a user with imported lines sees the same empty state, with their own counts", async ({
  page,
}) => {
  await signedInAs(page, romane);
  await visit(page, "/");

  await expect(
    emptyState(page).getByRole("heading", { name: "Your monthly review is not ready yet" }),
  ).toBeVisible();

  const links = worksToday(page).getByRole("link");

  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toContainText("Accounts");
  await expect(links.nth(0)).toContainText("1 account");
  await expect(links.nth(1)).toContainText("Import");
  // The harness's browser speaks en-US: "Nov 24". The day is the import's own, a real one.
  await expect(links.nth(1)).toContainText(/Last on [A-Z][a-z]{2} \d{1,2}\b/);
  await expect(links.nth(2)).toContainText("Operations");
  await expect(links.nth(2)).toContainText(
    imported.held === 0
      ? `${imported.added} lines`
      : `${imported.added} lines · ${imported.held} to review`,
  );
  await expect(page.getByText("Import your first statement")).toHaveCount(0);

  await expectNothingInvented(page);

  await links.nth(2).click();
  await expect(page).toHaveURL(/\/operations/);
  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();
});

test("the empty state speaks French", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "fr-FR" });

  try {
    const page = await context.newPage();

    await signedInAs(page, romane);
    await visit(page, "/");

    await expect(page.getByRole("heading", { level: 1, name: "Bilan du mois" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Votre bilan du mois n'est pas encore prêt" }),
    ).toBeVisible();
    await expect(page.getByRole("term")).toHaveText(["Revenus", "Dépensé", "Mis de côté", "Reste"]);

    const links = page.getByRole("list", { name: "Ce qui marche déjà" }).getByRole("link");

    await expect(links.nth(0)).toContainText("1 compte");
    await expect(links.nth(1)).toContainText("Dernier le");
  } finally {
    await context.close();
  }
});

test("month answers through MCP that the review is not available yet, inventing nothing", async ({
  page,
  baseURL,
  mcpClientId,
}) => {
  await signedInAs(page, romane);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: (consent) => consent.getByRole("button", { name: "Allow read only" }).click(),
    scope: "read write",
    clientId: mcpClientId,
  });

  const asked: ReadonlyArray<{ [key: string]: string; action: string }> = [
    { action: "summary", month: "2026-10" },
    { action: "review", month: "2026-10" },
    { action: "days", month: "2026-10", by: "category", row: "Groceries" },
  ];

  for (const args of asked) {
    const { text, isError } = await month(session.client, args);

    expect(isError, args.action).toBe(false);
    expect(text, args.action).toContain("The rest of the monthly review is not available yet");
    expect(text, args.action).toContain('accounts {"action":"list"}');
    expect(text, args.action).not.toMatch(/\d+\.\d\d/);
    expect(text, args.action).not.toContain("EUR");

    for (const name of [...INVENTED, "October"]) {
      expect(text, `${args.action}: ${name}`).not.toContain(name);
    }
  }

  // Her own lines are read where the answer points.
  const lines = await session.client.callTool({
    name: "lines",
    arguments: { action: "search", text: "fournil" },
  });

  const [first] = lines.content ?? [];

  expect(first?.type === "text" ? first.text : "").toContain("LE FOURNIL DES TILLEULS");
});
