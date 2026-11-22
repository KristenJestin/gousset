import type { Locator, Page } from "@playwright/test";

import { onPhone } from "../src/frame";
import { animationsDone, expect, test, visit } from "../src/test";

// The scenarios of issue #10, the monthly review on made-up data: what the screen shows, block by
// block, and its four motions. Each month here is a whole one, whatever the day of the run; a test
// that approves a line has a month of its own, since an approval lasts for the rest of the run.

const OCTOBER = "/?month=2026-10";

const block = (page: Page, title: string) => page.getByRole("region", { name: title });

const monthSwitcher = (page: Page) => page.getByRole("group", { name: "Month", exact: true });

/** The first amount a text holds, in cents: "Housing €690 benchmark €690" gives 69000. */
function centsIn(text: string): number {
  const match = /€([\d,]+(?:\.\d{2})?)/.exec(text);

  return match?.[1] === undefined ? 0 : Math.round(Number(match[1].replaceAll(",", "")) * 100);
}

/**
 * A secondary block's content: in its block on a wide screen; on a phone the block is one line,
 * which opens it in a sheet.
 */
async function openBlock(page: Page, title: string): Promise<Locator> {
  if (!onPhone(page)) {
    return block(page, title);
  }

  await block(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .click();

  const sheet = page.getByRole("dialog", { name: title });

  await expect(sheet).toBeVisible();

  return sheet;
}

/** A row of "Where the money goes", by its name: a button that opens its detail. */
const spendingRow = (page: Page, name: string) =>
  block(page, "Where the money goes").getByRole("button", { name: new RegExp(`^${name}`) });

test("the review of a month shows each of its blocks, labelled as made-up", async ({
  userPage: page,
}) => {
  await visit(page, OCTOBER);

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  await expect(monthSwitcher(page)).toContainText("October 2026");
  await expect(
    page.getByText("Made-up data: every account, line and amount here is invented."),
  ).toBeVisible();

  // The header: the state of the imports, and the link down to the lines to review.
  await expect(page.getByText(/\d of 4 accounts imported/)).toBeVisible();
  await expect(page.getByRole("link", { name: "6 lines to review" })).toHaveAttribute(
    "href",
    "#to-review",
  );

  // The month bar: what came in, cut into spent, set aside and left. October's meal vouchers were
  // all spent: nothing restricted, nothing hatched (September's are, below).
  const month = block(page, "The month");

  await expect(month).toContainText("received");
  await expect(month).toContainText("Salary and Meal vouchers");
  await expect(month).toContainText("spent");
  await expect(month).toContainText("set aside");
  await expect(month.locator('[data-slot="month-bar-restricted"]')).toHaveCount(0);

  await expect(block(page, "Where the money goes")).toContainText("Housing");

  // The movements between the accounts, the investments and what is flagged.
  const movements = await openBlock(page, "Movements between your accounts");

  await expect(movements).toContainText("Acme Consulting");
  await expect(movements).toContainText("buy World index ETF");
  await page.keyboard.press("Escape");

  const investments = await openBlock(page, "Investments");

  await expect(investments).toContainText("Northbank PEA");
  await page.keyboard.press("Escape");

  const flagged = await openBlock(page, "Flagged");

  await expect(flagged).toContainText("Streamly goes from €8.99 to €9.49");
  await page.keyboard.press("Escape");

  const toReview = await openBlock(page, "To review");

  await expect(toReview.getByRole("button", { name: /^Approve / })).toHaveCount(3);
  await expect(toReview).toContainText("Show the other 3");
  await page.keyboard.press("Escape");
  await animationsDone(page);
});

test("money left on the meal voucher card is hatched at the end of the part left", async ({
  userPage: page,
}) => {
  await visit(page, "/?month=2026-09");

  const month = block(page, "The month");

  await expect(month.locator('[data-slot="month-bar-restricted"]')).toHaveAttribute(
    "fill",
    /^url\(#/,
  );
  await expect(month).toContainText("left, €153 restricted");
  await animationsDone(page);
});

test("where the money goes has its three tabs, each row with its benchmark mark", async ({
  userPage: page,
}) => {
  await visit(page, OCTOBER);

  const spending = block(page, "Where the money goes");

  // The subscription's price rose this month: above its 6-month average, marked so.
  await expect(spending.locator('[data-slot="breakdown-benchmark"]').first()).toBeAttached();
  await expect(spendingRow(page, "Housing")).toContainText("€690");

  await spending.getByRole("tab", { name: "Merchants" }).click();
  await expect(spending.getByRole("tabpanel")).toContainText("Glycine Homes");

  await spending.getByRole("tab", { name: "Subjects" }).click();
  await expect(spending.getByRole("tabpanel")).toContainText("Home");
  await expect(spending.getByRole("tabpanel")).toContainText("Van");
  await animationsDone(page);
});

test("changing month moves the bars and amounts to the next month, the digits rolling", async ({
  userPage: page,
}) => {
  await visit(page, OCTOBER);

  const received = block(page, "The month").locator('[data-slot="amount"]').first();
  const october = await received.textContent();

  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();
  await expect(monthSwitcher(page)).toContainText("September 2026");

  // While a digit rolls, its column holds the old digit and the new one.
  await expect
    .poll(async () => page.locator('[data-slot="amount-digit"]:has(> :nth-child(2))').count())
    .toBeGreaterThan(0);
  await animationsDone(page);
  expect(await received.textContent()).not.toBe(october);
});

test("approving a line folds it away, the counter drops and its category's bar grows", async ({
  userPage: page,
}) => {
  // May is this test's own month.
  await visit(page, "/?month=2026-05");

  const toReview = await openBlock(page, "To review");

  const first = toReview
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: /^Approve / }) })
    .first();

  const category = (await first.locator("span.rounded-md").first().textContent()) ?? "";
  const label = (await first.getByRole("button").getAttribute("aria-label")) ?? "";
  const counter = block(page, "To review").locator('[data-slot="count"]').first();

  await expect(counter).toContainText("6");

  if (onPhone(page)) {
    // On a phone the sheet covers the categories: read them once it is closed.
    await page.keyboard.press("Escape");
  }

  const spending = block(page, "Where the money goes");
  const more = spending.getByRole("button", { name: /^Show the other \d+$/ });

  if ((await more.count()) > 0) {
    await more.click();
  }

  const row = spendingRow(page, category);
  const before = (await row.count()) === 0 ? 0 : centsIn((await row.textContent()) ?? "");

  const list = await openBlock(page, "To review");

  await list.getByRole("button", { name: label }).click();

  // The line folds away at once; the counter goes down.
  await expect(list.getByRole("button", { name: label })).toHaveCount(0);
  await expect(counter).toContainText("5");

  if (onPhone(page)) {
    await page.keyboard.press("Escape");
  }

  // Once the server has it, the category counts the line's expense.
  await expect.poll(async () => centsIn((await row.textContent()) ?? "")).toBeGreaterThan(before);
  await animationsDone(page);
});

test("opening a detail turns the row into its panel, and closing folds it back in place", async ({
  userPage: page,
}) => {
  await visit(page, OCTOBER);

  const housing = spendingRow(page, "Housing");

  await housing.click();

  const panel = block(page, "Where the money goes").getByRole("group", { name: "Housing" });

  await expect(panel).toBeVisible();
  await expect(panel.getByRole("figure", { name: /^Housing: spending in October/ })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(panel).toHaveCount(0);
  await expect(spendingRow(page, "Housing")).toBeFocused();
  await animationsDone(page);
});

test("hovering the chart moves its crosshair, and the value slides to the day under it", async ({
  userPage: page,
}) => {
  test.skip(onPhone(page), "A phone has no pointer to hover with.");

  await visit(page, OCTOBER);
  await spendingRow(page, "Groceries").click();

  const chart = block(page, "Where the money goes").getByRole("figure", {
    name: /^Groceries: spending in October/,
  });

  await expect(chart).toBeVisible();
  await animationsDone(page);

  // The plot itself: the last drawing of the figure, under its legend.
  const box = await chart
    .locator("svg")
    .filter({ has: page.locator("g") })
    .last()
    .boundingBox();

  if (box === null) {
    throw new Error("The chart has no plot to hover.");
  }

  const tooltip = page.locator('[data-slot="spending-tooltip"]');
  const y = box.y + box.height / 2;

  // Bklit's line chart listens to the pointer once its lines are drawn.
  await expect(async () => {
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.move(box.x + box.width * 0.2 + 2, y);
    await expect(tooltip).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 5000 });

  const early = await tooltip.textContent();

  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 8 });
  await expect.poll(async () => tooltip.textContent()).not.toBe(early);
  await page.mouse.move(0, 0);
  await animationsDone(page);
});
