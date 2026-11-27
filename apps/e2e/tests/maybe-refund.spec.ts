import type { Page } from "@playwright/test";
import { exampleStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";

import type { TestUser } from "../src/auth";
import { lineDetail } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { block, closeBlock, monthBarKey, openBlock } from "../src/review";
import { addUser, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #208's web half, "How to verify", one test each: a line coming back that may cancel a
// purchase is no income until the user answers. Before an answer, the month's received leaves it
// out and says it apart, and the operations list, the line's detail, the movements and the lines
// to review flag it; confirmed, it is the purchase's refund; refused, it is an ordinary income. Each
// test has a user of its own, whose October holds a purchase and, the day after, money back at the
// same shop, imported as the import job runs them. Every amount and label is invented. The MCP half
// is maybe-refund-mcp.spec.ts.

const TODAY = "2026-11-15";
const OCTOBER = "/?month=2026-10";

const LABEL = "CARD PIXELPLAY STORE";
const PURCHASE = { bookedOn: "2026-10-03", amountMinor: -9000, label: LABEL };
const MONEY_BACK = { bookedOn: "2026-10-04", amountMinor: 3000, label: LABEL };

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, with the purchase and the money back, signed in on the fixed day. */
async function withMoneyBack(
  page: Page,
  app: { readonly baseURL: string },
  user: TestUser,
  local: string,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);
  const accountId = await imports.createAccount(owner, "Everyday account");

  const statement: Statement = {
    ...exampleStatement,
    lines: [PURCHASE, MONEY_BACK].map((line, index) => ({
      ...line,
      reference: `${local}-${index + 1}`,
    })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${local}.ofx`),
  );

  expect(done.status).toBe("done");

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

/** What the month says was received, as written for screen readers: "€30". */
const received = (page: Page) =>
  block(page, "The month").locator('[data-slot="month-bar"] [data-slot="amount"] .sr-only').first();

const maybeRefunds = (page: Page) =>
  block(page, "The month").locator('[data-slot="month-bar-maybe-refunds"]');

const FLAG = '[data-slot="maybe-refund"]';

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

/** The operations of the shop, once the list places its rows itself (the browser runs the page). */
async function operations(page: Page) {
  await visit(page, "/operations?q=pixelplay");
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
  await expect(rows(page)).toHaveCount(2);
}

/** Opens the line of the shop whose row says `amount` too, and returns its detail. */
async function openLine(page: Page, amount: string) {
  await rows(page).filter({ hasText: amount }).getByRole("button").click();

  const detail = lineDetail(page, LABEL);

  await expect(detail).toBeVisible();

  return detail;
}

/** The month's movements block, opened (a sheet on a phone): its rows. */
async function movementRows(page: Page) {
  const movements = await openBlock(page, "Movements");

  return movements.getByRole("list", { name: "Movements" }).getByRole("listitem");
}

test("before confirmation, the month's received excludes the likely refund and shows it apart", async ({
  page,
  app,
  user,
}) => {
  await withMoneyBack(page, app, user, "rosalie");
  await visit(page, OCTOBER);

  // Nothing received: the €30 back waits apart, and the purchase still costs all it cost.
  await expect(received(page)).toHaveText("€0");
  await expect(maybeRefunds(page)).toHaveText("Not in received: €30 that may be a refund (1 line)");
  await expect(monthBarKey(page, "spent")).toContainText("€90");

  const movements = await movementRows(page);
  const flaggedMovement = movements.filter({ has: page.locator(FLAG) });

  await expect(flaggedMovement).toHaveCount(1);
  await expect(flaggedMovement).toContainText("Maybe a refund");
  await expect(flaggedMovement).toContainText("€30");
  await closeBlock(page);

  // Among the lines to review: flagged, not titled as an income of "Other".
  const toReview = await openBlock(page, "To review");

  const flaggedLine = toReview
    .locator('[data-slot="review-line"]')
    .filter({ has: page.locator(FLAG) });

  await expect(flaggedLine).toHaveCount(1);
  await expect(flaggedLine).toContainText(LABEL);
  await expect(flaggedLine).not.toContainText("Other");
  await closeBlock(page);

  // The operations list flags the row, with no category.
  await operations(page);

  const flaggedRow = rows(page).filter({ has: page.locator(FLAG) });

  await expect(flaggedRow).toHaveCount(1);
  await expect(flaggedRow).toContainText("Maybe a refund");
  await expect(flaggedRow).toContainText("30.00");
  await expect(flaggedRow).not.toContainText("Other");

  // Its detail proposes the purchase, and says the line is not counted until answered.
  const detail = await openLine(page, "30.00");
  const proposal = detail.getByRole("region", { name: "Maybe a refund" });

  await expect(proposal).toContainText("costs €90.00");
  await expect(proposal).toContainText("Until you answer, it is not counted as received.");
  await expect(proposal.getByRole("button", { name: "Link as a refund" })).toBeVisible();
  await expect(proposal.getByRole("button", { name: "Not a refund" })).toBeVisible();
});

test("after confirmation, the purchase's net cost drops", async ({ page, app, user }) => {
  await withMoneyBack(page, app, user, "anselme");
  await operations(page);

  const detail = await openLine(page, "30.00");

  await detail
    .getByRole("region", { name: "Maybe a refund" })
    .getByRole("button", { name: "Link as a refund" })
    .click();

  const question = page.getByRole("alertdialog", { name: "Link as a refund?" });

  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Link", exact: true }).click();
  await expect(question).toHaveCount(0);

  // One expense: the €90 purchase, the €30 back, a net cost of €60.
  const expense = detail.getByRole("region", { name: "One expense, counted once" });

  await expect(expense).toContainText("Refunds");
  await expect(expense.locator('[data-slot="expense-net"]')).toContainText("€60.00");
  await expect(detail.getByRole("region", { name: "Maybe a refund" })).toHaveCount(0);

  // The list reads it again: no flag any more.
  await expect(rows(page).filter({ has: page.locator(FLAG) })).toHaveCount(0);

  // The month: nothing received, nothing waiting, €60 spent.
  await visit(page, OCTOBER);
  await expect(received(page)).toHaveText("€0");
  await expect(maybeRefunds(page)).toHaveCount(0);
  await expect(monthBarKey(page, "spent")).toContainText("€60");

  const movements = await movementRows(page);

  await expect(movements.filter({ has: page.locator(FLAG) })).toHaveCount(0);
  await closeBlock(page);
});

test("after refusal, it is an income", async ({ page, app, user }) => {
  await withMoneyBack(page, app, user, "honorine");
  await operations(page);

  const detail = await openLine(page, "30.00");

  // Answered at once: no question, the section goes.
  await detail
    .getByRole("region", { name: "Maybe a refund" })
    .getByRole("button", { name: "Not a refund" })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(detail.getByRole("region", { name: "Maybe a refund" })).toHaveCount(0);
  await expect(rows(page).filter({ has: page.locator(FLAG) })).toHaveCount(0);

  // Opened again, nothing is proposed: the answer is kept.
  await operations(page);
  await expect(rows(page).filter({ has: page.locator(FLAG) })).toHaveCount(0);

  const reopened = await openLine(page, "30.00");

  await expect(reopened.getByRole("region", { name: "One expense, counted once" })).toHaveCount(0);
  await expect(reopened.getByRole("region", { name: "Maybe a refund" })).toHaveCount(0);

  // The month: the €30 received, nothing waiting, the purchase still €90.
  await visit(page, OCTOBER);
  await expect(received(page)).toHaveText("€30");
  await expect(maybeRefunds(page)).toHaveCount(0);
  await expect(monthBarKey(page, "spent")).toContainText("€90");

  const movements = await movementRows(page);

  await expect(movements.filter({ has: page.locator(FLAG) })).toHaveCount(0);
  await expect(movements.filter({ hasText: "€30" })).toHaveCount(1);
  await closeBlock(page);
});
