import { account, statementLine } from "@gousset/db/schema/ledger";
import { and, eq } from "drizzle-orm";

import { expect, expectAccessible, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #15's pages: the accounts overview and an account's own page, and the MCP tool's e2e
// scenario lives in accounts-mcp.spec.ts. Every test shares the worker's seeded user
// (packages/fixture): "Current account" (Riverside Bank), "Livret A" (Riverside Bank), "MealCard"
// (MealCard, a benefit account) and "Northbank PEA". Accounts this file creates are named "E2E …"
// so they never collide with the fixture's own.

let data: ReturnType<typeof openUserData>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  owner = await data.ownerOf(user.email);
  await data.seed(owner);
});

test.afterAll(async () => {
  await data.close();
});

/** Every choice the create form offers, with the group it lands in (docs/data-model.md). */
const KINDS = [
  { choice: "Current account", group: "Available" },
  { choice: "Savings", group: "Savings and investments" },
  { choice: "Livret A", group: "Savings and investments" },
  { choice: "Card", group: "Available" },
  { choice: "Securities account", group: "Savings and investments" },
  { choice: "PEA", group: "Savings and investments" },
  { choice: "Life insurance", group: "Savings and investments" },
  { choice: "Loan", group: "Loans" },
  { choice: "Benefit account", group: "Restricted use" },
] as const;

for (const { choice, group } of KINDS) {
  test(`creating a "${choice}" account shows it in "${group}", with the group's total`, async ({
    userPage: page,
  }) => {
    await visit(page, "/accounts");

    const name = `E2E ${choice}`;

    await page.getByRole("button", { name: "Add an account", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Add an account" });

    // The first account created this way is checked for accessibility with the dialog open: the
    // controls (Select, DatePicker, MoneyField) are new to this page.
    if (choice === "Current account") {
      await expectAccessible(page);
    }

    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: choice, exact: true }).click();

    if (choice === "Card") {
      // "Current account" was created first: it is the open current account this card settles into.
      await dialog.getByRole("combobox", { name: "Settles into" }).click();
      await page.getByRole("option", { name: "E2E Current account", exact: true }).click();
    }

    await dialog.getByRole("button", { name: "Add the account" }).click();
    await expect(dialog).toBeHidden();

    const region = page.getByRole("region", { name: group });

    await expect(region.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    // The group's total is shown beside its heading, in the account's currency.
    await expect(region.locator("header")).toContainText("€");
  });
}

test("editing an account changes its settings, and refuses a new currency once it has a line", async ({
  userPage: page,
}) => {
  await visit(page, "/accounts");
  await page.getByRole("link", { name: /E2E Savings/ }).click();

  await page.getByRole("button", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog", { name: "Edit the account" });

  await editDialog.getByRole("textbox", { name: "Name" }).fill("E2E Savings (renamed)");
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(editDialog).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E Savings (renamed)" }),
  ).toBeVisible();

  // The seeded "Current account" has lines (the seed's statements): its currency is locked. Its
  // name alone (not "E2E Current account", created above with no lines) finds it.
  await visit(page, "/accounts");
  await page.getByRole("link", { name: /^Current account/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  const currencyDialog = page.getByRole("dialog", { name: "Edit the account" });

  await currencyDialog.getByRole("textbox", { name: "Currency" }).fill("USD");
  await currencyDialog.getByRole("button", { name: "Save" }).click();

  await expect(currencyDialog).toContainText(
    "The currency cannot change once the account has a line or a balance.",
  );
  await expect(currencyDialog).toBeVisible();
});

test("closing an account leaves it apart, shown with the closed accounts; reopening brings it back", async ({
  userPage: page,
}) => {
  await visit(page, "/accounts");
  await page.getByRole("link", { name: /E2E Loan/ }).click();

  await page.getByRole("button", { name: "Close" }).click();

  const closeDialog = page.getByRole("dialog", { name: "Close E2E Loan?" });

  await closeDialog.getByRole("button", { name: "Close the account" }).click();
  await expect(closeDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page.getByRole("region", { name: "Loans" })).toHaveCount(0);

  const closed = page.locator('[data-slot="closed-accounts"]');

  await closed.getByRole("button", { name: /closed account/ }).click();
  await expect(closed.getByRole("link", { name: /E2E Loan/ })).toBeVisible();

  await closed.getByRole("link", { name: /E2E Loan/ }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(
    page.getByRole("region", { name: "Loans" }).getByRole("link", { name: /E2E Loan/ }),
  ).toBeVisible();
});

test("an account's page shows its lines, its balance day by day and an agreeing balance check", async ({
  userPage: page,
}) => {
  await fixDay(page, "2026-10-31");
  await visit(page, "/accounts");
  await page.getByRole("link", { name: /Livret A/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Livret A" })).toBeVisible();
  await expect(page.getByText("Balance checked")).toBeVisible();
  await expect(page.getByText(/in the app = .* on the statement of/)).toBeVisible();
  await expect(
    page.getByRole("list").filter({ has: page.getByText("SEPA TRF TO LIVRET A") }),
  ).toHaveCount(1);
  await expect(page.locator('[data-slot="balance-chart"]')).toBeVisible();
});

test("an account's page shows the difference when its balance disagrees with the statement", async ({
  userPage: page,
}) => {
  const [current] = await data.asUser(owner, (each) =>
    each.select({ id: account.id }).from(account).where(eq(account.name, "Current account")),
  );

  if (current === undefined) {
    throw new Error("The seed wrote no Current account.");
  }

  // The seed's rent line, fixed whatever its run: deleting it unbalances the statement on purpose.
  await data.asUser(owner, (each) =>
    each
      .delete(statementLine)
      .where(
        and(
          eq(statementLine.accountId, current.id),
          eq(statementLine.label, "DIRECT DEBIT GLYCINE HOMES RENT"),
          eq(statementLine.bookedOn, "2026-10-05"),
        ),
      ),
  );

  await fixDay(page, "2026-10-31");
  await visit(page, `/accounts/${current.id}`);

  await expect(page.getByText("Balance does not match")).toBeVisible();
  await expect(page.getByText(/a difference of \+€690\.00/)).toBeVisible();
});

test("noting a balance on a balance-mode account shows it as the account's balance", async ({
  userPage: page,
}) => {
  await fixDay(page, "2026-10-31");
  await visit(page, "/accounts");

  await page.getByRole("button", { name: "Add an account", exact: true }).click();

  const createDialog = page.getByRole("dialog", { name: "Add an account" });

  await createDialog.getByRole("textbox", { name: "Name" }).fill("E2E PerksHub");
  await createDialog.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Benefit account", exact: true }).click();
  await createDialog.getByRole("combobox", { name: "Tracking" }).click();
  await page.getByRole("option", { name: "Balance", exact: true }).click();
  await createDialog.getByRole("button", { name: "Add the account" }).click();
  await expect(createDialog).toBeHidden();

  await page.getByRole("link", { name: /E2E PerksHub/ }).click();
  await expect(page.getByText("Nothing noted yet")).toBeVisible();

  await page.getByRole("textbox", { name: "Amount" }).fill("312.40");
  await page.getByRole("button", { name: "Note the balance" }).click();

  await expect(page.getByText(/Balance noted for/)).toBeVisible();
  await expect(page.getByText("€312.40").first()).toBeVisible();
});

test("under reduced motion, a newly created account appears without sliding in", async ({
  userPage: page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page, "/accounts");

  await page.getByRole("button", { name: "Add an account", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add an account" });

  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E Reduced Motion");
  await dialog.getByRole("button", { name: "Add the account" }).click();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("link", { name: /E2E Reduced Motion/ }).locator("..");

  await expect(row).toHaveCSS("animation-duration", "0s");
});
