import { account, accountBalance, statementImport, statementLine } from "@gousset/db/schema/ledger";

import { expect, expectAccessible, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #15's pages: the accounts overview and an account's own page, and the MCP tool's e2e
// scenario lives in accounts-mcp.spec.ts. `playwright.config.ts`'s `fullyParallel` runs this
// file's tests in any order, on either of the worker's app instances, sharing one seeded user with
// every other spec file of the worker (notably accounts-mcp.spec.ts, which reads the seeded
// "Current account" and expects its check to still agree on 2026-10-31): each test here makes
// every account (and, for the disagreeing check, every row) it needs, named uniquely so two tests
// never collide, and never changes a seeded row. The two tests that read the seed's own accounts
// (the agreeing check, the currency lock's alternative) only read them.

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
    const name = `E2E ${choice}`;

    // A card needs one of the user's open current accounts: made here, not by another test, so
    // the test still passes whatever order the file's tests run in.
    const settlesIntoName = `E2E ${choice} Settlement Current`;

    if (choice === "Card") {
      const [settlement] = await data.asUser(owner, (each) =>
        each
          .insert(account)
          .values({ userId: owner, name: settlesIntoName, kind: "current", currency: "EUR" })
          .returning({ id: account.id }),
      );

      if (settlement === undefined) {
        throw new Error("The insert returned no row.");
      }
    }

    await visit(page, "/accounts");

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
      await dialog.getByRole("combobox", { name: "Settles into" }).click();
      await page.getByRole("option", { name: settlesIntoName, exact: true }).click();
    }

    await dialog.getByRole("button", { name: "Add the account" }).click();
    await expect(dialog).toBeHidden();

    const region = page.getByRole("region", { name: group });

    await expect(region.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    // The group's total is shown beside its heading, in the account's currency.
    await expect(region.locator("header")).toContainText("€");
  });
}

test("editing an account changes its settings", async ({ userPage: page }) => {
  await visit(page, "/accounts");
  await page.getByRole("button", { name: "Add an account", exact: true }).click();

  const createDialog = page.getByRole("dialog", { name: "Add an account" });

  await createDialog.getByRole("textbox", { name: "Name" }).fill("E2E Edit Target");
  await createDialog.getByRole("button", { name: "Add the account" }).click();
  await expect(createDialog).toBeHidden();

  await page.getByRole("link", { name: /E2E Edit Target/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog", { name: "Edit the account" });

  await editDialog.getByRole("textbox", { name: "Name" }).fill("E2E Edit Target (renamed)");
  await editDialog.getByRole("button", { name: "Save" }).click();
  await expect(editDialog).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "E2E Edit Target (renamed)" }),
  ).toBeVisible();
});

test("editing an account refuses a new currency once it has a line", async ({ userPage: page }) => {
  const [created] = await data.asUser(owner, (each) =>
    each
      .insert(account)
      .values({ userId: owner, name: "E2E Currency Lock", kind: "current", currency: "EUR" })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The insert returned no row.");
  }

  await data.asUser(owner, (each) =>
    each.insert(statementLine).values({
      userId: owner,
      accountId: created.id,
      source: "manual",
      bookedOn: "2026-10-05",
      amountMinor: -500,
      label: "E2E CURRENCY LOCK LINE",
    }),
  );

  await visit(page, `/accounts/${created.id}`);
  await page.getByRole("button", { name: "Edit" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit the account" });

  await dialog.getByRole("textbox", { name: "Currency" }).fill("USD");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(dialog).toContainText(
    "The currency cannot change once the account has a line or a balance.",
  );
  await expect(dialog).toBeVisible();
});

test("closing an account leaves it apart, shown with the closed accounts; reopening brings it back", async ({
  userPage: page,
}) => {
  await visit(page, "/accounts");
  await page.getByRole("button", { name: "Add an account", exact: true }).click();

  const createDialog = page.getByRole("dialog", { name: "Add an account" });

  await createDialog.getByRole("textbox", { name: "Name" }).fill("E2E Close Target");
  await createDialog.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Loan", exact: true }).click();
  await createDialog.getByRole("button", { name: "Add the account" }).click();
  await expect(createDialog).toBeHidden();

  await page.getByRole("link", { name: /E2E Close Target/ }).click();
  await page.getByRole("button", { name: "Close" }).click();

  const closeDialog = page.getByRole("dialog", { name: "Close E2E Close Target?" });

  await closeDialog.getByRole("button", { name: "Close the account" }).click();
  await expect(closeDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).click();

  // Another test of this file may have its own loan open at the same time: only this account's own
  // row leaves the group, not the whole region.
  await expect(
    page.getByRole("region", { name: "Loans" }).getByRole("link", { name: /E2E Close Target/ }),
  ).toHaveCount(0);

  const closed = page.locator('[data-slot="closed-accounts"]');

  await closed.getByRole("button", { name: /closed account/ }).click();
  await expect(closed.getByRole("link", { name: /E2E Close Target/ })).toBeVisible();

  await closed.getByRole("link", { name: /E2E Close Target/ }).click();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(
    page.getByRole("region", { name: "Loans" }).getByRole("link", { name: /E2E Close Target/ }),
  ).toBeVisible();
});

test("an account's page shows its lines, its balance day by day and an agreeing balance check", async ({
  userPage: page,
}) => {
  await fixDay(page, "2026-10-31");
  await visit(page, "/accounts");
  // Anchored: a "Livret A" choice created by the kinds loop above would otherwise also match, as
  // "E2E Livret A".
  await page.getByRole("link", { name: /^Livret A/ }).click();

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
  const day = "2026-10-31";
  const lineAmountMinor = 100_000;
  const statementBalanceMinor = 99_000;

  const created = await data.asUser(owner, async (each) => {
    const [inserted] = await each
      .insert(account)
      .values({ userId: owner, name: "E2E Disagreeing Account", kind: "current", currency: "EUR" })
      .returning({ id: account.id });

    if (inserted === undefined) {
      throw new Error("The insert returned no row.");
    }

    const [done] = await each
      .insert(statementImport)
      .values({
        userId: owner,
        accountId: inserted.id,
        fileName: "e2e-disagreeing-account.csv",
        fileSha256: "e2e-disagreeing-account-sha256",
        format: "csv",
        status: "done",
        periodFrom: "2026-10-01",
        periodTo: day,
      })
      .returning({ id: statementImport.id });

    if (done === undefined) {
      throw new Error("The insert returned no row.");
    }

    await each.insert(statementLine).values({
      userId: owner,
      accountId: inserted.id,
      importId: done.id,
      source: "import",
      bookedOn: "2026-10-05",
      amountMinor: lineAmountMinor,
      label: "E2E DISAGREEING SALARY",
      bankId: "e2e-disagreeing-account-bank-id",
      dedupKey: "e2e-disagreeing-account-dedup-key",
    });

    await each.insert(accountBalance).values({
      userId: owner,
      accountId: inserted.id,
      day,
      balanceMinor: statementBalanceMinor,
      source: "statement",
      importId: done.id,
    });

    return inserted;
  });

  await fixDay(page, day);
  await visit(page, `/accounts/${created.id}`);

  await expect(page.getByText("Balance does not match")).toBeVisible();
  // app (100,000) − statement (99,000) = +10.00: the app counts more.
  await expect(page.getByText(/a difference of \+€10\.00/)).toBeVisible();
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
