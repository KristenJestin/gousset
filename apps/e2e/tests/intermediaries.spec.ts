import type { Page } from "@playwright/test";
import { merchant, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";

import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import {
  addUser,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #30's screens, one test per scenario of "How to verify": a line paid through a payment
// intermediary asks, on the operations page, who was really paid; the merchant chosen proposes a
// rule, which gives the next such line its merchant; and a merchant the user marks as an
// intermediary on its page makes its lines ask. The MCP scenarios are intermediaries-mcp.spec.ts.
// Statements are imported as the app's import job runs them, recognising their merchants. Each test
// has a user of its own. Every line and shop here is invented but PayPal's name, which Gousset
// knows.

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

/** A user of the test's own, its owner id, and an account of theirs to import into. */
async function personFor(
  app: { baseURL: string },
  admin: TestUser,
  local: string,
): Promise<{ person: TestUser; owner: string; accountId: string }> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  return { person, owner, accountId: await imports.createAccount(owner, "Everyday") };
}

/** The page, signed in as `person`, on the fixed day, at `path` (checked by axe). */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

const line = (bookedOn: string, amountMinor: number, label: string, reference: string) => ({
  bookedOn,
  amountMinor,
  label,
  reference,
});

/**
 * A statement of `month` (`2026-10`) holding `lines`, imported into the account to the end, as the
 * import job runs it; the lines' ids, in the order given.
 */
async function importLines(
  owner: string,
  accountId: string,
  month: string,
  lines: ReadonlyArray<StatementLine>,
): Promise<Array<string>> {
  const imported = await imports.importFile(
    owner,
    accountId,
    statementFile(
      "ofx",
      { ...exampleStatement, from: `${month}-01`, to: `${month}-28`, lines: [...lines] },
      `everyday-${month}.ofx`,
    ),
  );

  expect(imported.status).toBe("done");

  const found = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, label: statementLine.label })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn)),
  );

  return lines.map(({ label }) => {
    const row = found.find((each) => each.label === label);

    if (row === undefined) {
      throw new Error(`The line ${label} was not imported.`);
    }

    return row.id;
  });
}

/** The id of the user's merchant of that name. */
async function merchantId(owner: string, name: string): Promise<string> {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: merchant.id }).from(merchant).where(eq(merchant.name, name)),
  );

  if (found === undefined) {
    throw new Error(`No merchant ${name}.`);
  }

  return found.id;
}

/** Who the open line paid, in its detail: `data-state` is `asks` or `known`. */
const lineMerchant = (page: Page) => page.locator('[data-slot="line-merchant"]');

const merchantDialog = (page: Page) => page.getByRole("dialog", { name: "Who was paid?" });

const proposalDialog = (page: Page) => page.getByRole("dialog", { name: "Make it a rule?" });

/** The toasts' landmark: the announcer repeats a toast's text for screen readers, outside it. */
const notifications = (page: Page) => page.getByRole("region", { name: "Notifications" });

const FIRST = "CB PAYPAL *PIXELPLAY 21/10";

test("an intermediary's line asks for its merchant", async ({ page, app, user }) => {
  const { person, owner, accountId } = await personFor(app, user, "intermediary-asks");

  const [first] = await importLines(owner, accountId, "2026-10", [
    line("2026-10-21", -1999, FIRST, "PP2110"),
  ]);

  await as(page, person, `/operations?line=${first}`);

  // Recognition made Paypal's merchant from the label, marked as an intermediary: the line asks.
  const said = lineMerchant(page);

  await expect(said).toHaveAttribute("data-state", "asks");
  await expect(said).toContainText("Who was really paid?");
  await expect(said).toContainText("Paid through Paypal");

  // By the keyboard: the button opens the dialog, Enter in its field assigns the name typed.
  await said.getByRole("button", { name: "Choose the merchant" }).focus();
  await page.keyboard.press("Enter");

  const dialog = merchantDialog(page);

  await expect(dialog).toContainText("Paid through Paypal");
  await expectAccessible(page);
  await dialog.getByRole("combobox", { name: "Merchant" }).pressSequentially("Pixelplay");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  // The row names who was paid, through the intermediary, and asks no more.
  await expect(said).toHaveAttribute("data-state", "known");
  await expect(said).toContainText("Pixelplay");
  await expect(said).toContainText("through Paypal");

  // The rule it proposes looks for the intermediary through who was paid, never Paypal alone.
  const proposal = proposalDialog(page);
  const words = proposal.getByRole("textbox", { name: "Label contains" });

  await expect(proposal).toContainText("will have Pixelplay as their merchant");
  await expect(words).toHaveValue("PAYPAL *PIXELPLAY");
  await expectAccessible(page);
  await words.press("Enter");
  await expect(proposal).toBeHidden();
  await expect(notifications(page).getByText("Rule created.")).toBeVisible();

  // Focus is back on the button that opened the dialog, which now changes the merchant.
  await expect(page.getByRole("button", { name: "Change the merchant" })).toBeFocused();

  await visit(page, "/settings/rules");
  await expect(
    page.getByRole("button", { name: "label contains “PAYPAL *PIXELPLAY”", exact: true }),
  ).toBeVisible();
});

test("the rule assigns it next time", async ({ page, app, user }) => {
  const { person, owner, accountId } = await personFor(app, user, "intermediary-rule");

  const [first] = await importLines(owner, accountId, "2026-10", [
    line("2026-10-21", -1999, FIRST, "PP2110"),
  ]);

  // Who was paid, chosen once, and the rule it proposes, made.
  await as(page, person, `/operations?line=${first}`);
  await lineMerchant(page).getByRole("button", { name: "Choose the merchant" }).click();
  await merchantDialog(page).getByRole("combobox", { name: "Merchant" }).fill("Pixelplay");
  await merchantDialog(page).getByRole("button", { name: "Assign" }).click();
  await expect(proposalDialog(page).getByRole("textbox", { name: "Label contains" })).toHaveValue(
    "PAYPAL *PIXELPLAY",
  );
  await proposalDialog(page).getByRole("button", { name: "Create the rule" }).click();
  await expect(proposalDialog(page)).toBeHidden();

  // A later statement: its Pixelplay line gets its merchant by the rule; another shop paid through
  // the same intermediary still asks.
  const later = "CB PAYPAL *PIXELPLAY 04/11";
  const elsewhere = "CB PAYPAL *BRIGHTREAD 06/11";

  const [ruled, other] = await importLines(owner, accountId, "2026-11", [
    line("2026-11-04", -1499, later, "PP0411"),
    line("2026-11-06", -899, elsewhere, "PP0611"),
  ]);

  await visit(page, `/operations?line=${ruled}`);

  const said = lineMerchant(page);

  await expect(said).toHaveAttribute("data-state", "known");
  await expect(said).toContainText("Pixelplay");
  await expect(said).toContainText("through Paypal");
  await expect(said).not.toContainText("Who was really paid?");
  await expect(said.getByRole("button", { name: "Choose the merchant" })).toHaveCount(0);

  await visit(page, `/operations?line=${other}`);
  await expect(lineMerchant(page)).toHaveAttribute("data-state", "asks");
  await expect(lineMerchant(page)).toContainText("Paid through Paypal");
});

test("a merchant marked as an intermediary makes its lines ask", async ({ page, app, user }) => {
  const { person, owner, accountId } = await personFor(app, user, "intermediary-marked");
  const label = "CB PAYLINK *CORNER BAKERY 03/11";

  const [bakery] = await importLines(owner, accountId, "2026-11", [
    line("2026-11-03", -640, label, "PL0311"),
  ]);

  // Gousset does not know this intermediary: the line is its label's merchant's, and asks nothing.
  await as(page, person, `/operations?line=${bakery}`);
  await expect(lineMerchant(page)).toHaveAttribute("data-state", "known");
  await expect(lineMerchant(page)).toContainText("Paylink");
  await expect(lineMerchant(page).getByRole("button")).toHaveCount(0);

  // Marked on its page: the switch applies at once, and stays so.
  const paylink = await merchantId(owner, "Paylink");

  await visit(page, `/settings/merchants/${paylink}`);

  const marked = page.getByRole("switch", { name: "Payment intermediary" });

  await expect(marked).not.toBeChecked();
  await expect(page.getByText("Its labels hide who was paid")).toBeVisible();
  await marked.click();
  await expect(marked).toBeChecked();

  // The switch shows the mark before its save ends: a reload before that would read it unsaved.
  await expect
    .poll(async () => {
      const [row] = await data.asUser(owner, (transaction) =>
        transaction
          .select({ intermediary: merchant.isIntermediary })
          .from(merchant)
          .where(eq(merchant.id, paylink)),
      );

      return row?.intermediary;
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Payment intermediary" })).toBeChecked();

  // The merchants' list says so under its name.
  await visit(page, "/settings/merchants");
  await expect(
    page.getByRole("list", { name: "Merchants" }).getByRole("link", { name: /^Paylink / }),
  ).toContainText("payment intermediary");

  // Its line now asks who was really paid.
  await visit(page, `/operations?line=${bakery}`);
  await expect(lineMerchant(page)).toHaveAttribute("data-state", "asks");
  await expect(lineMerchant(page)).toContainText("Paid through Paylink");
  await expect(
    lineMerchant(page).getByRole("button", { name: "Choose the merchant" }),
  ).toBeVisible();
});
