import { account, statementLine } from "@gousset/db/schema/ledger";
import type { Locator, Page } from "@playwright/test";

import { expect, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #16's pages: a benefit account's credits, their order of use and expiries, and its money
// apart from the money available. Like accounts.spec.ts, every test makes the accounts and lines it
// needs, named uniquely, on the worker's shared seeded user, and never changes a seeded row. The MCP
// scenario lives in accounts-mcp.spec.ts.

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

/** The day every test of this file is seen on: after every line, before every expiry. */
const TODAY = "2026-10-31";

type SeedLine = { bookedOn: string; amountMinor: number; label: string; expiresOn?: string };

/** A lines-mode account of `owner`'s, with its lines, as the user's own transaction writes them. */
async function seedAccount(
  values: { name: string; kind: "current" | "benefit"; openingBalanceMinor?: number },
  lines: ReadonlyArray<SeedLine>,
): Promise<string> {
  return data.asUser(owner, async (each) => {
    const [created] = await each
      .insert(account)
      .values({
        userId: owner,
        name: values.name,
        kind: values.kind,
        institution: values.kind === "benefit" ? "MealCard" : "Riverside Bank",
        currency: "EUR",
        openingBalanceMinor: values.openingBalanceMinor ?? 0,
      })
      .returning({ id: account.id });

    if (created === undefined) {
      throw new Error("The insert returned no row.");
    }

    for (const line of lines) {
      await each.insert(statementLine).values({
        userId: owner,
        accountId: created.id,
        source: "manual",
        bookedOn: line.bookedOn,
        amountMinor: line.amountMinor,
        label: line.label,
        expiresOn: line.expiresOn ?? null,
      });
    }

    return created.id;
  });
}

/**
 * Two credits, the older one expiring later, and a payment of €30.00 after both: oldest first, it
 * comes out of September's credit; soonest expiry first, out of October's.
 */
const TWO_CREDITS: ReadonlyArray<SeedLine> = [
  {
    bookedOn: "2026-09-01",
    amountMinor: 10_000,
    label: "MEALCARD CREDIT",
    expiresOn: "2026-12-31",
  },
  { bookedOn: "2026-10-01", amountMinor: 8000, label: "MEALCARD CREDIT", expiresOn: "2026-11-30" },
  { bookedOn: "2026-10-15", amountMinor: -3000, label: "E2E BAKERY" },
];

/** A day as the page words it in English ("Nov 30"): `apps/web/src/lib/account-day.ts`. */
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );

const creditsOf = (page: Page) => page.locator('[data-slot="benefit-credits"]');

const creditRows = (page: Page) => creditsOf(page).locator('[data-slot="benefit-credit"]');

const expiringRows = (page: Page) => creditsOf(page).locator('[data-slot="benefit-expiring"]');

/** A total as written ("€1,234", "−€12.50"), as a number of units. */
async function unitsOf(amount: Locator): Promise<number> {
  const text = await amount.innerText();

  return Number(text.replaceAll("−", "-").replaceAll(/[^\d.-]/g, ""));
}

test("a benefit account uses its oldest credit first", async ({ userPage: page }) => {
  const id = await seedAccount({ name: "E2E MealCard Oldest", kind: "benefit" }, TWO_CREDITS);

  await fixDay(page, TODAY);
  await visit(page, `/accounts/${id}`);

  // Its balance, €150.00, is restricted money: hatched.
  await expect(
    page.locator('[data-slot="restricted-amount"]').filter({ hasText: "€150.00" }),
  ).toBeVisible();

  await expect(creditsOf(page)).toContainText("Oldest first");

  // The payment took €30.00 from September's credit; October's is whole.
  const credits = creditRows(page);

  await expect(credits).toHaveCount(2);
  await expect(credits.nth(0)).toContainText(shortDay("2026-09-01"));
  await expect(credits.nth(0)).toContainText("€70.00");
  await expect(credits.nth(0)).toContainText("of €100.00");
  await expect(credits.nth(0)).toContainText(`expires ${shortDay("2026-12-31")}`);
  await expect(credits.nth(1)).toContainText(shortDay("2026-10-01"));
  await expect(credits.nth(1)).toContainText("€80.00");
  await expect(credits.nth(1)).toContainText("of €80.00");
  await expect(credits.nth(1)).toContainText(`expires ${shortDay("2026-11-30")}`);

  // What expires when, soonest first.
  const expiring = expiringRows(page);

  await expect(expiring).toHaveCount(2);
  await expect(expiring.nth(0)).toContainText(shortDay("2026-11-30"));
  await expect(expiring.nth(0)).toContainText("€80.00");
  await expect(expiring.nth(1)).toContainText(shortDay("2026-12-31"));
  await expect(expiring.nth(1)).toContainText("€70.00");

  // A credit line of the lines list says when it expires.
  const lines = page.locator('[data-slot="account-lines"] li');

  await expect(lines.filter({ hasText: `expires ${shortDay("2026-11-30")}` })).toHaveCount(1);
  await expect(lines.filter({ hasText: `expires ${shortDay("2026-12-31")}` })).toHaveCount(1);
  await expect(lines.filter({ hasText: "E2E BAKERY" })).not.toContainText("expires");

  // The settings name the order of use.
  await expect(page.getByText("Order of use").last()).toBeVisible();
});

test("a benefit account uses its credits in the issuer's order", async ({ userPage: page }) => {
  const id = await seedAccount({ name: "E2E MealCard Issuer", kind: "benefit" }, TWO_CREDITS);

  await fixDay(page, TODAY);
  await visit(page, `/accounts/${id}`);
  await expect(creditRows(page).nth(0)).toContainText("of €100.00");

  // Exact: a credit's "Expiry date of MEALCARD CREDIT" button holds "edit" in "CREDIT".
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Edit the account" });
  const order = dialog.getByRole("combobox", { name: "Order of use" });

  // The form starts from the account's own order.
  await expect(order).toContainText("Oldest first");
  await order.click();
  await page
    .getByRole("option", { name: "Soonest expiry first, as the issuer does", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await expect(creditsOf(page)).toContainText("Soonest expiry first, as the issuer does");

  // Now the payment came out of October's credit, the sooner to expire, which comes first.
  const credits = creditRows(page);

  await expect(credits.nth(0)).toContainText("€50.00");
  await expect(credits.nth(0)).toContainText("of €80.00");
  await expect(credits.nth(1)).toContainText("€100.00");
  await expect(credits.nth(1)).toContainText("of €100.00");

  const expiring = expiringRows(page);

  await expect(expiring.nth(0)).toContainText("€50.00");
  await expect(expiring.nth(1)).toContainText("€100.00");
});

test("a credit's expiry date is set from the account page", async ({ userPage: page }) => {
  const id = await seedAccount({ name: "E2E MealCard Expiry", kind: "benefit" }, [
    { bookedOn: "2026-10-01", amountMinor: 8000, label: "MEALCARD CREDIT" },
  ]);

  await fixDay(page, TODAY);
  await visit(page, `/accounts/${id}`);

  const credit = creditRows(page);

  await expect(credit).toHaveCount(1);
  await expect(credit).not.toContainText("expires");
  await expect(expiringRows(page)).toHaveCount(0);

  await credit.getByRole("button", { name: "Expiry date of MEALCARD CREDIT" }).click();

  const dialog = page.getByRole("dialog", { name: "When does MEALCARD CREDIT expire?" });
  const calendar = page.locator('[data-slot="date-picker-content"]');

  // November 30th: today is in October, the calendar opens on it.
  await dialog.getByRole("button", { name: "Choose a date" }).click();
  await calendar.getByRole("button", { name: "Next month" }).click();
  await calendar.getByRole("gridcell", { name: /November 30, 2026/ }).click();
  await dialog.getByRole("button", { name: "Save the expiry" }).click();
  await expect(dialog).toBeHidden();

  await expect(credit).toContainText(`expires ${shortDay("2026-11-30")}`);
  await expect(expiringRows(page)).toHaveCount(1);
  await expect(expiringRows(page)).toContainText("€80.00");

  // A day before the credit's own is refused, and says why.
  await credit.getByRole("button", { name: "Expiry date of MEALCARD CREDIT" }).click();
  await dialog.getByRole("button", { name: "Choose a date" }).click();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.getByRole("gridcell", { name: /September 15, 2026/ }).click();
  await dialog.getByRole("button", { name: "Save the expiry" }).click();

  await expect(dialog).toContainText("A credit cannot expire before the day it was credited.");
  await expect(dialog).toBeVisible();
});

test("a benefit account kept by its balance shows no credits, its balance hatched", async ({
  userPage: page,
}) => {
  const [created] = await data.asUser(owner, (each) =>
    each
      .insert(account)
      .values({
        userId: owner,
        name: "E2E MealCard Balance",
        kind: "benefit",
        institution: "MealCard",
        currency: "EUR",
        mode: "balance",
        openingBalanceMinor: 4200,
      })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The insert returned no row.");
  }

  await fixDay(page, TODAY);
  await visit(page, `/accounts/${created.id}`);

  await expect(
    page.locator('[data-slot="restricted-amount"]').filter({ hasText: "€42.00" }),
  ).toBeVisible();
  await expect(creditsOf(page)).toHaveCount(0);
});

test("money moved from a current account to a benefit account moves from available to restricted", async ({
  userPage: page,
}) => {
  const currentId = await seedAccount(
    { name: "E2E Top-up Current", kind: "current", openingBalanceMinor: 20_000 },
    [],
  );

  const benefitId = await seedAccount({ name: "E2E MealCard Top-up", kind: "benefit" }, []);

  await fixDay(page, TODAY);
  await visit(page, "/accounts");

  const available = page.getByRole("region", { name: "Available" });
  const restricted = page.getByRole("region", { name: "Restricted use" });

  // Each group's total in euros, beside its heading: the available one whole, the restricted one
  // hatched, to the cent.
  const availableTotal = available.locator('header [data-slot="amount"]').filter({ hasText: "€" });

  const restrictedTotal = restricted
    .locator('header [data-slot="restricted-amount"]')
    .filter({ hasText: "€" });

  await expect(restrictedTotal).toBeVisible();

  const availableBefore = await unitsOf(availableTotal);
  const restrictedBefore = await unitsOf(restrictedTotal);

  // €50.00 leave the current account for the benefit account.
  await data.asUser(owner, async (each) => {
    await each.insert(statementLine).values([
      {
        userId: owner,
        accountId: currentId,
        source: "manual",
        bookedOn: "2026-10-20",
        amountMinor: -5000,
        label: "E2E TOP-UP TO MEALCARD",
      },
      {
        userId: owner,
        accountId: benefitId,
        source: "manual",
        bookedOn: "2026-10-20",
        amountMinor: 5000,
        label: "MEALCARD CREDIT",
      },
    ]);
  });

  await page.reload();

  await expect.poll(() => unitsOf(availableTotal)).toBeCloseTo(availableBefore - 50, 2);
  await expect.poll(() => unitsOf(restrictedTotal)).toBeCloseTo(restrictedBefore + 50, 2);

  // The benefit account's own figure is hatched in its group; the available group has none.
  await expect(
    restricted
      .getByRole("link", { name: /^E2E MealCard Top-up( |$)/ })
      .locator('[data-slot="restricted-amount"]'),
  ).toContainText("€50.00");
  await expect(available.locator('[data-slot="restricted-amount"]')).toHaveCount(0);
});
