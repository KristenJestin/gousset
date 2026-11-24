import type { Page } from "@playwright/test";

import { addUser } from "../src/auth";
import { lineDetail } from "../src/frame";
import { animationsDone, expect, expectAccessible, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #26 on the operations page: a line's transfer, its other side one click away, "Not a
// transfer" and pairing it again through the dialog. The user is the test's own, holding the
// made-up data, whose transfers the seed paired: each month, "SEPA TRF TO LIVRET A" leaves the
// Current account for the Livret A, both sides under that label.

const TODAY = "2026-11-15";
const LABEL = "SEPA TRF TO LIVRET A";

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

const rows = (page: Page) => page.getByRole("list", { name: "Operations" }).getByRole("listitem");

/** The open detail of a line of `LABEL` that says `text`: both sides carry the same label. */
const detailSaying = (page: Page, text: string) =>
  lineDetail(page, LABEL).filter({ hasText: text });

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

test("the operations page shows a line's transfer, goes to its other side, unpairs and pairs it again", async ({
  page,
  app,
  user,
}, testInfo) => {
  test.setTimeout(60_000);

  const person = await addUser(app.baseURL, user, {
    name: "Lou Example",
    email: `lou.operations-transfers.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-lou-password-${app.slot}`,
  });

  await data.seed(await data.ownerOf(person.email));
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  await visit(page, "/operations?q=livret%20a");
  await hydrated(page);

  // October's line out of the Current account, the newest of its kind.
  await rows(page)
    .filter({ hasText: LABEL })
    .filter({ hasText: "Current account" })
    .first()
    .getByRole("button")
    .click();

  const out = detailSaying(page, "Transfer to Livret A");

  await expect(out).toBeVisible();
  await expect(out).toContainText("Set aside");
  await animationsDone(page);
  await expectAccessible(page);

  // One click goes to the other side.
  await out.getByRole("button", { name: new RegExp(LABEL) }).click();

  const into = detailSaying(page, "Transfer from Current account");

  await expect(into).toBeVisible();

  // Not a transfer: asked, then unpaired; the line out is its candidate.
  await into.getByRole("button", { name: "Not a transfer" }).click();

  const question = page.getByRole("alertdialog", { name: "Not a transfer?" });

  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Unpair" }).click();
  await expect(question).toHaveCount(0);

  const maybe = detailSaying(page, "Maybe a transfer");

  await expect(maybe).toBeVisible();
  await expect(maybe).toContainText("Current account");
  await expect(maybe).not.toContainText("Transfer from");

  // Paired again through the dialog, its one candidate checked.
  await maybe.getByRole("button", { name: "Pair as a transfer" }).click();

  const dialog = page.getByRole("dialog", { name: "Pair as a transfer" });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await expect(dialog.getByRole("radio")).toBeChecked();
  await animationsDone(page);
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Pair", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(detailSaying(page, "Transfer from Current account")).toBeVisible();
  await animationsDone(page);
});
