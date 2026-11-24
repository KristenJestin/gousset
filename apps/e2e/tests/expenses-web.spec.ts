import type { Page } from "@playwright/test";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { animationsDone, expect, expectAccessible, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #27 on the operations page: a cancellation proposed as a refund and confirmed, the expense
// then shown once at its net cost with its payments and refunds; a line split across two
// categories in the side sheet, the shares making the whole line; a line linked to an expense from
// the dialog, then separated again. The user is the test's own; statements are imported as the
// import job runs them. Every amount and label is invented.

const TODAY = "2026-11-15";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

/** Imports these lines into a new current account of the user's. */
async function importInto(
  owner: string,
  name: string,
  lines: ReadonlyArray<Omit<StatementLine, "reference">>,
) {
  const accountId = await imports.createAccount(owner, name);

  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${name}.ofx`),
  );

  expect(done.status, name).toBe("done");
}

/** Opens the line of this label whose row says `text` too. */
async function openLine(page: Page, label: string, text: string) {
  await rows(page)
    .filter({ hasText: label })
    .filter({ hasText: text })
    .first()
    .getByRole("button")
    .click();
  await expect(page.getByRole("region", { name: label })).toBeVisible();

  return page.getByRole("region", { name: label });
}

test("the operations page proposes a cancellation as a refund, links it once confirmed, splits a line and separates a payment", async ({
  page,
  app,
  user,
}, testInfo) => {
  test.setTimeout(90_000);

  const person = await addUser(app.baseURL, user, {
    name: "Lou Example",
    email: `lou.expenses.worker${app.slot}.${testInfo.repeatEachIndex}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-lou-password-${app.slot}`,
  });

  const owner = await data.ownerOf(person.email);

  await importInto(owner, "Everyday account", [
    { bookedOn: "2026-10-03", amountMinor: -5600, label: "CB CORNER BISTRO 0310 RIVERTON" },
    { bookedOn: "2026-10-06", amountMinor: 5600, label: "AVOIR CORNER BISTRO RIVERTON" },
    { bookedOn: "2026-10-08", amountMinor: -9000, label: "CB LANTERN STORES 0810 RIVERTON" },
    { bookedOn: "2026-10-12", amountMinor: -2500, label: "CB HARBOR HOME 1210 RIVERTON" },
  ]);

  await importInto(owner, "Travel card", [
    { bookedOn: "2026-10-12", amountMinor: -5000, label: "CB HARBOR HOME 1210 RIVERTON" },
  ]);

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  // A purchase cancelled: proposed as a refund, never applied unasked.
  await visit(page, "/operations?q=corner%20bistro");
  await hydrated(page);

  const cancelled = await openLine(page, "AVOIR CORNER BISTRO RIVERTON", "56.00");
  const proposal = cancelled.getByRole("region", { name: "Maybe a refund" });

  await expect(proposal).toContainText("CB CORNER BISTRO 0310 RIVERTON");
  await expect(proposal).toContainText("Other · costs €56.00");
  await animationsDone(page);
  await expectAccessible(page);

  await proposal.getByRole("button", { name: "Link as a refund" }).click();

  const question = page.getByRole("alertdialog", { name: "Link as a refund?" });

  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Link", exact: true }).click();
  await expect(question).toHaveCount(0);

  // One expense, counted once: its payment, its refund, a net cost of nothing.
  const expense = cancelled.getByRole("region", { name: "One expense, counted once" });

  await expect(expense).toBeVisible();
  await expect(expense).toContainText("Payments");
  await expect(expense).toContainText("Refunds");
  await expect(expense.locator('[data-slot="expense-net"]')).toContainText("€0.00");
  await expect(cancelled.getByRole("region", { name: "Maybe a refund" })).toHaveCount(0);

  // A split line sums to the line: 30 in Groceries, 60 left in Other.
  await visit(page, "/operations?q=lantern");
  await hydrated(page);

  const stores = await openLine(page, "CB LANTERN STORES 0810 RIVERTON", "90.00");

  await stores.getByRole("button", { name: "Split", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Split across categories" });

  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-slot="split-left"]')).toHaveText(
    "The shares make the whole line.",
  );

  await sheet.getByRole("textbox", { name: "Amount 1" }).fill("60");
  await expect(sheet.locator('[data-slot="split-left"]')).toHaveText("€30.00 left to place");
  await expect(sheet.getByRole("button", { name: "Save the split" })).toBeDisabled();

  await sheet.getByRole("button", { name: "Add a category" }).click();
  await sheet.getByRole("combobox", { name: "Category 2" }).pressSequentially("groc");
  await page.getByRole("option", { name: "Groceries", exact: true }).click();
  await expect(sheet.locator('[data-slot="split-left"]')).toHaveText(
    "The shares make the whole line.",
  );
  await animationsDone(page);
  await expectAccessible(page);

  // A sheet still open after the save says why: its text (a refusal under the shares), whether its
  // button is busy, the calls sent and answered since, and any error the page threw.
  const save = sheet.getByRole("button", { name: "Save the split" });
  const sent: Array<string> = [];
  const answered: Array<string> = [];
  const thrown: Array<string> = [];

  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/")) {
      sent.push(request.method());
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/_serverFn/")) {
      answered.push(String(response.status()));
    }
  });
  page.on("pageerror", (error) => {
    thrown.push(error.message);
  });

  await save.click();
  await expect
    .poll(async () =>
      (await sheet.count()) === 0
        ? ""
        : [
            await sheet.innerText(),
            `busy: ${String(await save.getAttribute("aria-busy"))}`,
            `sent: ${sent.join(",")}`,
            `answered: ${answered.join(",")}`,
            `thrown: ${thrown.join("; ")}`,
          ].join("\n"),
    )
    .toBe("");

  const shares = stores.getByRole("region", { name: "Split across 2 categories" });

  await expect(shares).toBeVisible();
  await expect(shares.locator('[data-slot="expense-share"]')).toHaveCount(2);
  await expect(shares).toContainText("Groceries");
  await expect(shares).toContainText("€30.00");
  await expect(shares).toContainText("€60.00");

  // 75 paid 25 + 50 on two accounts: linked from the card's line, then separated again.
  await visit(page, "/operations?q=harbor%20home");
  await hydrated(page);

  const onCard = await openLine(page, "CB HARBOR HOME 1210 RIVERTON", "Travel card");

  await onCard.getByRole("button", { name: "Link to an expense" }).click();

  const dialog = page.getByRole("dialog", { name: "Link to an expense" });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox", { name: "Search a line" }).fill("harbor home");
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Link", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const linked = onCard.getByRole("region", { name: "One expense, counted once" });

  await expect(linked).toBeVisible();
  await expect(linked.locator('[data-slot="expense-part"]')).toHaveCount(2);
  await expect(linked.locator('[data-slot="expense-net"]')).toContainText("€75.00");

  await linked.getByRole("button", { name: "Separate this line" }).click();

  const separate = page.getByRole("alertdialog", { name: "Separate this line?" });

  await separate.getByRole("button", { name: "Separate", exact: true }).click();
  await expect(separate).toHaveCount(0);
  // The scenario ends on its own assertions, not on "nothing animating": once its block changes,
  // the line detail's own content fade can stay mid-way, the known open bug #128.
  await expect(onCard.getByRole("region", { name: "One expense, counted once" })).toHaveCount(0);
});
