import { account, category, statementLine } from "@gousset/db/schema/ledger";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { eq } from "drizzle-orm";
import { Schema } from "effect";

import type { WorkerEnvironment } from "../src/app-server";
import { addUser } from "../src/auth";
import type { TestUser } from "../src/auth";
import { animationsDone, expect, expectAccessible, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #31 in the browser: an account kept by its balance makes one movement per noted balance,
// in the category chosen in its form, and a line of a followed account is paired with it from the
// line's detail, the app making the account's side. Each test has a user of its own, holding only
// what the test makes, so that no other line is a candidate and no other account is offered. Every
// name and amount is invented.

const TODAY = "2026-11-15";

/** The line that tops the benefit account up from the current account. */
const TOP_UP = "E2E TOP-UP PERKSHUB";

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

type Fixtures = { page: Page; app: WorkerEnvironment; user: TestUser };

/** A user of the test's own, the page signed in as them on `TODAY`: their id. */
async function signedInAsOwnUser(
  { page, app, user }: Fixtures,
  local: string,
  testInfo: TestInfo,
): Promise<string> {
  const person = await addUser(app.baseURL, user, {
    name: "Kai Example",
    email: `${local}.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-${local}-password-${app.slot}`,
  });

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  return data.ownerOf(person.email);
}

/** A current account of `owner`'s with one line of −€50.00 on 12 October 2026: the line's id. */
async function currentAccountWithTopUp(owner: string): Promise<string> {
  return data.asUser(owner, async (each) => {
    const [created] = await each
      .insert(account)
      .values({
        userId: owner,
        name: "E2E Everyday",
        kind: "current",
        institution: "Riverside Bank",
        currency: "EUR",
      })
      .returning({ id: account.id });

    if (created === undefined) {
      throw new Error("The insert returned no row.");
    }

    const [line] = await each
      .insert(statementLine)
      .values({
        userId: owner,
        accountId: created.id,
        source: "manual",
        bookedOn: "2026-10-12",
        amountMinor: -5000,
        label: TOP_UP,
      })
      .returning({ id: statementLine.id });

    if (line === undefined) {
      throw new Error("The insert returned no row.");
    }

    return line.id;
  });
}

/** Opens the account form from the accounts page: a benefit account kept by its balance. */
async function balanceAccountForm(page: Page, name: string) {
  await visit(page, "/accounts");
  await page.getByRole("button", { name: "Add an account", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add an account" });

  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("combobox", { name: "Kind" }).click();
  await page.getByRole("option", { name: "Benefit account", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Tracking" }).click();
  await page.getByRole("option", { name: "Balance", exact: true }).click();

  return dialog;
}

/** Chooses the category of the form's account, found by typing over the "None" it starts from. */
async function chooseCategory(page: Page, dialog: Locator, words: string) {
  const field = dialog.getByRole("combobox", { name: "Category" });

  await field.click();
  await field.press("ControlOrMeta+A");
  await field.pressSequentially(words);
  await page.getByRole("option", { name: `${words} (expense)`, exact: true }).click();
}

/** Notes a balance from the account page, its day chosen in the calendar, which opens on today. */
async function noteBalance(page: Page, monthsBack: number, day: RegExp, amount: string) {
  await page.getByRole("button", { name: "Note a balance", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Note a balance" });
  const calendar = page.locator('[data-slot="date-picker-content"]');

  await dialog.getByRole("button", { name: "Choose a date" }).click();

  for (let month = 0; month < monthsBack; month += 1) {
    await calendar.getByRole("button", { name: "Previous month" }).click();
  }

  await calendar.getByRole("gridcell", { name: day }).click();
  await dialog.getByRole("textbox", { name: "Amount" }).fill(amount);
  await dialog.getByRole("button", { name: "Note the balance" }).click();
  await expect(dialog).toBeHidden();
}

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

/** Each animation still running: its name or property, and where (the nearest `data-slot`). */
const RUNNING = `document.getAnimations().map((each) => [
  each.animationName ?? each.transitionProperty ?? "",
  each.effect?.target?.closest?.("[data-slot]")?.getAttribute("data-slot") ?? each.effect?.target?.tagName ?? "",
].join(" in "))`;

const decodeRunning = Schema.decodeUnknownSync(Schema.Array(Schema.String));

/** Waits until nothing animates, naming what still does when it times out. */
async function nothingAnimates(page: Page): Promise<void> {
  await expect
    .poll(async () => decodeRunning(await page.evaluate(RUNNING)), {
      message: "the animations still running",
    })
    .toEqual([]);
}

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

/** Opens the top-up's detail from the operations page. */
async function openTopUp(page: Page) {
  await visit(page, "/operations");
  await hydrated(page);
  await rows(page).filter({ hasText: TOP_UP }).getByRole("button").click();

  const detail = page.getByRole("region", { name: TOP_UP });

  await expect(detail).toBeVisible();

  return detail;
}

test("a balance going from 120 to 80 with a transfer of 50 in gives an expense of 90", async ({
  page,
  app,
  user,
}, testInfo) => {
  test.setTimeout(60_000);

  const owner = await signedInAsOwnUser({ page, app, user }, "kai.balance-accounts", testInfo);

  await currentAccountWithTopUp(owner);

  // A benefit account kept by its balance, its movements in an expense category of its own.
  const form = await balanceAccountForm(page, "E2E PerksHub");

  await chooseCategory(page, form, "Groceries › Bakery");
  await form.getByRole("button", { name: "Add the account" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("link", { name: /^E2E PerksHub( |$)/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E PerksHub" })).toBeVisible();

  // The settings name the category its movements go to.
  await expect(page.getByText("Groceries › Bakery")).toBeVisible();

  const benefitId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

  // 120.00 at the end of September.
  await noteBalance(page, 2, /September 30, 2026/, "120.00");

  // The top-up's other side is the benefit account, which has no line of its own: the app makes it.
  const detail = await openTopUp(page);

  await detail.getByRole("button", { name: "Pair with an account" }).click();

  const pairing = page.getByRole("dialog", { name: "Pair with an account" });

  await expect(pairing.getByRole("radio", { name: "E2E PerksHub" })).toBeChecked();
  await pairing.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(pairing).toHaveCount(0);
  await expect(detail).toContainText("Transfer to E2E PerksHub");
  await expect(detail).toContainText("Made by Gousset");

  // 80.00 at the end of October: 80 − 120 − 50 = −90 spent.
  await visit(page, `/accounts/${benefitId}`);
  await noteBalance(page, 1, /October 31, 2026/, "80.00");

  const movements = page
    .locator('[data-slot="account-lines"] li')
    .filter({ hasText: "Balance movement" });

  await expect(movements).toHaveCount(2);
  await expect(movements.filter({ hasText: "−€90.00" })).toHaveCount(1);
  await expect(movements.filter({ hasText: "€120.00" })).toHaveCount(1);

  // The operations list the movement as one expense, in the account's category.
  await visit(page, `/operations?account=${benefitId}`);
  await hydrated(page);

  const expense = rows(page).filter({ hasText: "Balance movement" }).filter({ hasText: "−€90.00" });

  await expect(expense).toContainText("Groceries › Bakery");

  // Its detail names it too, made from a noted balance.
  await expense.getByRole("button").click();

  const movement = page.getByRole("region", { name: "Balance movement" });

  await expect(movement).toContainText("Made from a noted balance");
  await expect(movement).not.toContainText("Pair with an account");
  await nothingAnimates(page);
  await expectAccessible(page);
});

test("a category archived while the form is open is refused, and the form says why", async ({
  page,
  app,
  user,
}, testInfo) => {
  const owner = await signedInAsOwnUser({ page, app, user }, "kai.balance-archived", testInfo);

  const [perks] = await data.asUser(owner, (each) =>
    each
      .insert(category)
      .values({ userId: owner, kind: "expense", name: "E2E Perks", position: 99 })
      .returning({ id: category.id }),
  );

  if (perks === undefined) {
    throw new Error("The insert returned no row.");
  }

  const form = await balanceAccountForm(page, "E2E PerksHub Archived");

  await chooseCategory(page, form, "E2E Perks");

  // Archived elsewhere meanwhile: no account may choose it any more.
  await data.asUser(owner, (each) =>
    each.update(category).set({ archivedAt: new Date() }).where(eq(category.id, perks.id)),
  );

  await form.getByRole("button", { name: "Add the account" }).click();
  await expect(form).toContainText("This category is archived: choose one in use.");
  await expect(form).toBeVisible();
  await animationsDone(page);
});

test("the pairing dialog fades and grows in 200 ms, and appears at once under reduced motion", async ({
  page,
  app,
  user,
}, testInfo) => {
  const owner = await signedInAsOwnUser({ page, app, user }, "kai.balance-motion", testInfo);

  await currentAccountWithTopUp(owner);
  await data.asUser(owner, (each) =>
    each.insert(account).values({
      userId: owner,
      name: "E2E PerksHub Motion",
      kind: "benefit",
      institution: "PerksHub",
      currency: "EUR",
      mode: "balance",
    }),
  );

  const detail = await openTopUp(page);
  const dialog = page.getByRole("dialog", { name: "Pair with an account" });

  // Closed with its own Cancel, so that the line's detail behind it stays open.
  await detail.getByRole("button", { name: "Pair with an account" }).click();
  await expect(dialog).toHaveCSS("transition-duration", "0.2s");
  await expect(dialog).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await detail.getByRole("button", { name: "Pair with an account" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0s");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
