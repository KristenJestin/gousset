import type { Page } from "@playwright/test";
import { statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Schema } from "effect";

import type { TestUser } from "../src/auth";
import { onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { addUser, animationsDone, expect, fixDay, personOfItsOwn, test, visit } from "../src/test";
import type { WorkerEnvironment } from "../src/app-server";
import { openUserData } from "../src/user-data";

// Issue #35's web half, "How to verify", one test each: the operations page's review mode ("To
// review only"), its proposals, accepted or corrected by a button or a key, one line after the
// other; its shortcuts and their setting, its motion, and a phone. The MCP half is
// review-mcp.spec.ts. Each test has a user of its own, whose lines to review come from statements
// imported as the import job runs them: three lines classified by default, then two of them read
// again from a CSV, held as near duplicates. Every amount and label is invented.

const TODAY = "2026-11-15";

const GROCER = { bookedOn: "2026-10-09", amountMinor: -4320, label: "CB HARBOR GROCER 0910" };
const STREAMING = { bookedOn: "2026-10-20", amountMinor: -1899, label: "PRLV NIMBUS STREAMING" };
const GYM = { bookedOn: "2026-10-22", amountMinor: -2999, label: "PRLV CITYGYM MEMBERSHIP" };

/** The same payments read again from a CSV: a day later, their labels written otherwise. */
const STREAMING_AGAIN = {
  bookedOn: "2026-10-21",
  amountMinor: -1899,
  label: "NIMBUS STREAMING ABO",
};

const GYM_AGAIN = { bookedOn: "2026-10-23", amountMinor: -2999, label: "CITYGYM MEMBER" };

/** The lines to review, newest first, as the list shows them. */
const IN_ORDER = [GYM_AGAIN, GYM, STREAMING_AGAIN, STREAMING, GROCER].map((line) => line.label);

/** A statement of these lines alone, each with a reference of its own. */
function statementOf(name: string, lines: ReadonlyArray<Omit<StatementLine, "reference">>) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  return statement;
}

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/**
 * A user of the test's own, with the five lines to review, signed in on `page` on the fixed day;
 * their owner id, to read the lines back.
 */
async function reviewer(page: Page, app: WorkerEnvironment, admin: TestUser, name: string) {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(name));
  const owner = await data.ownerOf(person.email);
  const imports = importsOn(data);
  const accountId = await imports.createAccount(owner, "Review current");

  const first = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statementOf(`${name}-first`, [GROCER, STREAMING, GYM]), `${name}.ofx`),
  );

  expect(first.status).toBe("done");

  const again = await imports.importFile(
    owner,
    accountId,
    statementFile("csv", statementOf(`${name}-again`, [STREAMING_AGAIN, GYM_AGAIN]), `${name}.csv`),
  );

  expect(again).toMatchObject({ linesAdded: 0, linesHeld: 2 });

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  return { person, owner };
}

/** The operations page in review mode, once its scripts run and the keys listen. */
async function openReview(page: Page) {
  await visit(page, "/operations?review=true");
  await expect(count(page)).toHaveText("5 lines");
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
  await page.waitForLoadState("networkidle");
}

const list = (page: Page) => page.getByRole("list", { name: "Operations" });

/** The row whose label is exactly `label`: "CITYGYM MEMBER" is no row of "PRLV CITYGYM MEMBERSHIP". */
const row = (page: Page, label: string) =>
  list(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(label, { exact: true }) });

const count = (page: Page) => page.locator('[data-slot="operations-count"]');

// A line's detail: a panel beside the list on a wide screen, a sheet on a phone.
const detail = (page: Page, label: string) =>
  page.getByRole(onPhone(page) ? "dialog" : "region", { name: label, exact: true });

const proposalOf = (page: Page, label: string) =>
  detail(page, label).locator('[data-slot="review-proposal"]');

const announcer = (page: Page) => page.locator('[data-slot="review-announcer"]');

/** The review state of the user's line of that label. */
async function reviewStateOf(owner: string, label: string) {
  const [found] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ reviewState: statementLine.reviewState, state: statementLine.state })
      .from(statementLine)
      .where(eq(statementLine.label, label)),
  );

  return found;
}

test("the proposal shows for a line classified by default and for a held repeat", async ({
  page,
  app,
  user,
}) => {
  await reviewer(page, app, user, "romy");
  await openReview(page);

  await row(page, GROCER.label).getByRole("button").click();

  const kept = proposalOf(page, GROCER.label);

  await expect(kept).toHaveAttribute("data-kind", "category");
  await expect(kept).toContainText("Gousset proposes");
  await expect(kept).toContainText(/Keep it in Other/);
  await expect(
    kept.getByRole("button", { name: `Accept the proposal for ${GROCER.label}` }),
  ).toBeVisible();
  await expect(kept.getByRole("button", { name: `Correct ${GROCER.label}` })).toBeVisible();
  // Said to screen readers: the line, then the proposal.
  await expect(announcer(page)).toHaveAttribute("aria-live", "polite");
  await expect(announcer(page)).toContainText(`To review: Oct 9, ${GROCER.label}`);
  await expect(announcer(page)).toContainText("Keep it in Other");

  if (onPhone(page)) {
    await page.keyboard.press("Escape");
    // Closed, its line gone from the address, before the next row opens its own.
    await expect(detail(page, GROCER.label)).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]line=/);
  }

  await row(page, GYM_AGAIN.label).getByRole("button").click();

  const held = proposalOf(page, GYM_AGAIN.label);

  await expect(held).toHaveAttribute("data-kind", "duplicate");
  await expect(held).toContainText(`Discard it: it repeats the line of Oct 22, ${GYM.label}, `);
  await expect(
    held.getByRole("button", { name: `Keep it: ${GYM_AGAIN.label} is no repeat` }),
  ).toBeVisible();
  await expect(announcer(page)).toContainText(`To review: Oct 23, ${GYM_AGAIN.label}`);
  await animationsDone(page);
});

test("A accepts the proposal, the line leaves the list and the next line opens", async ({
  page,
  app,
  user,
}) => {
  const { owner } = await reviewer(page, app, user, "anouk");

  await openReview(page);
  await row(page, GYM.label).getByRole("button").click();
  await expect(proposalOf(page, GYM.label)).toBeVisible();

  await page.keyboard.press("a");

  // The line below opens, its proposal focused; the count goes down.
  await expect(proposalOf(page, STREAMING_AGAIN.label)).toBeVisible();
  await expect(row(page, GYM.label)).toHaveCount(0);
  await expect(count(page)).toHaveText("4 lines");

  if (!onPhone(page)) {
    await expect(
      detail(page, STREAMING_AGAIN.label).locator('[data-slot="line-review"]'),
    ).toBeFocused();
  }

  await expect(page).toHaveURL(/[?&]review=true/);
  expect(await reviewStateOf(owner, GYM.label)).toMatchObject({ reviewState: "done" });

  // Accepted with its button: the held repeat is discarded, and the next line opens.
  await proposalOf(page, STREAMING_AGAIN.label)
    .getByRole("button", { name: `Accept the proposal for ${STREAMING_AGAIN.label}` })
    .click();
  await expect(proposalOf(page, STREAMING.label)).toBeVisible();
  await expect(count(page)).toHaveText("3 lines");
  expect(await reviewStateOf(owner, STREAMING_AGAIN.label)).toMatchObject({ state: "discarded" });

  // Read again from the server, the lines reviewed stay out.
  await page.reload();
  await expect(count(page)).toHaveText("3 lines");
  await expect(row(page, GYM.label)).toHaveCount(0);
  await animationsDone(page);
});

test("C opens the dialog, a category corrects the line, and the rule proposal shows", async ({
  page,
  app,
  user,
}) => {
  const { owner } = await reviewer(page, app, user, "sacha");

  await openReview(page);
  await row(page, GROCER.label).getByRole("button").click();
  await expect(proposalOf(page, GROCER.label)).toBeVisible();

  await page.keyboard.press("c");

  const dialog = page.getByRole("dialog", { name: "Correct this line" });
  const picker = dialog.getByRole("combobox", { name: "Category" });

  await expect(dialog).toBeVisible();
  await expect(picker).toHaveValue("Other");

  // The keys are the dialog's while it is open: A does not accept the line behind it.
  await page.keyboard.press("a");
  await page.waitForTimeout(300);
  await expect(dialog).toBeVisible();
  expect((await reviewStateOf(owner, GROCER.label))?.reviewState).not.toBe("done");

  await picker.fill("");
  await picker.pressSequentially("supermar");
  await page.getByRole("option", { name: "Groceries › Supermarket" }).click();
  await dialog.getByRole("button", { name: "Correct the line" }).click();
  await expect(dialog).toBeHidden();

  // As the page proposes a rule after any correction.
  await expect(page.getByRole("dialog", { name: "Make it a rule?" })).toBeVisible();
  expect(await reviewStateOf(owner, GROCER.label)).toMatchObject({ reviewState: "done" });
  await page
    .getByRole("dialog", { name: "Make it a rule?" })
    .getByRole("button", { name: "Cancel" })
    .click();

  // It was the last line: the one above opens.
  await expect(proposalOf(page, STREAMING.label)).toBeVisible();
  await expect(row(page, GROCER.label)).toHaveCount(0);
  await expect(count(page)).toHaveText("4 lines");
  await animationsDone(page);
});

test("a held repeat kept counts, and stays to review with its category", async ({
  page,
  app,
  user,
}) => {
  const { owner } = await reviewer(page, app, user, "ilian");

  await openReview(page);
  await row(page, GYM_AGAIN.label).getByRole("button").click();
  await proposalOf(page, GYM_AGAIN.label)
    .getByRole("button", { name: `Keep it: ${GYM_AGAIN.label} is no repeat` })
    .click();

  // No dialog: it is kept, and its proposal is now its category's.
  await expect(proposalOf(page, GYM_AGAIN.label)).toHaveAttribute("data-kind", "category");
  await expect(proposalOf(page, GYM_AGAIN.label)).toContainText(/Keep it in Other/);
  await expect(count(page)).toHaveText("5 lines");
  expect(await reviewStateOf(owner, GYM_AGAIN.label)).toMatchObject({ state: "counted" });
  await animationsDone(page);
});

test("J and K move between the lines to review, the first opening when none is open", async ({
  page,
  app,
  user,
}) => {
  test.skip(
    onPhone(page),
    "On a phone the detail is a sheet over the list; the keys are a desktop's",
  );

  await reviewer(page, app, user, "maelle");
  await openReview(page);

  await page.keyboard.press("j");
  await expect(proposalOf(page, IN_ORDER[0] ?? "")).toBeVisible();
  await page.keyboard.press("j");
  await expect(proposalOf(page, IN_ORDER[1] ?? "")).toBeVisible();
  await page.keyboard.press("j");
  await expect(proposalOf(page, IN_ORDER[2] ?? "")).toBeVisible();
  await page.keyboard.press("k");
  await expect(proposalOf(page, IN_ORDER[1] ?? "")).toBeVisible();

  // Every action is a button reached by Tab too.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: `Accept the proposal for ${IN_ORDER[1] ?? ""}` }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: `Correct ${IN_ORDER[1] ?? ""}` })).toBeFocused();

  // A field that has the focus keeps its keys.
  await page.getByRole("searchbox", { name: "Search" }).focus();
  await page.keyboard.press("j");
  await expect(proposalOf(page, IN_ORDER[1] ?? "")).toBeVisible();
  await animationsDone(page);
});

test("the review's shortcuts are listed by ?", async ({ page, app, user }) => {
  await reviewer(page, app, user, "noa");
  await openReview(page);

  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  await expect(dialog).toBeVisible();

  for (const label of [
    "Next line to review",
    "Previous line to review",
    "Accept the proposal",
    "Correct the line",
  ]) {
    await expect(dialog.getByRole("term").filter({ hasText: label })).toHaveCount(1);
  }

  // The list open, the review's keys do nothing.
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]line=/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

/** Turns the user's single-key shortcuts on or off in the settings, kept on the account. */
async function setSingleKeyShortcuts(page: Page, on: boolean) {
  await visit(page, "/settings");

  const setting = page.getByRole("switch", { name: "Single-key shortcuts" });

  if ((await setting.isChecked()) !== on) {
    const saved = page.waitForResponse((response) => response.request().method() === "POST");

    await setting.click();
    await saved;
  }

  await expect(setting).toBeChecked({ checked: on });
}

test("with single-key shortcuts off, the review's keys do nothing and its buttons still work", async ({
  page,
  app,
  user,
}) => {
  await reviewer(page, app, user, "elio");
  await setSingleKeyShortcuts(page, false);
  await openReview(page);

  await page.keyboard.press("j");
  // Still closed once every key handler has run.
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]line=/);

  await row(page, GYM.label).getByRole("button").click();
  await expect(proposalOf(page, GYM.label)).toBeVisible();
  await page.keyboard.press("a");
  await page.waitForTimeout(300);
  await expect(count(page)).toHaveText("5 lines");

  await proposalOf(page, GYM.label)
    .getByRole("button", { name: `Accept the proposal for ${GYM.label}` })
    .click();
  await expect(count(page)).toHaveText("4 lines");

  // Not listed either.
  await page.keyboard.press("ControlOrMeta+/");

  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });

  await expect(shortcuts.getByRole("term")).toHaveText(["Show keyboard shortcuts", "Search"]);
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();
});

const Heights = Schema.Array(Schema.Number);

/**
 * Samples, each animation frame until `window.__e2eStop`, the height of the row whose text holds
 * `label`, while it is in the page: 47 px whole, 0 folded. Its content's (`clientHeight`), its 1 px
 * bottom border left out: a row at its folded height of 0 still draws that border until it is
 * removed, which is no frame of a fold. Install before the action that removes it.
 */
async function sampleRowHeights(page: Page, label: string) {
  await page.evaluate(`(() => {
    window.__e2eHeights = [];
    window.__e2eStop = false;

    const sample = () => {
      const found = [...document.querySelectorAll('[data-slot="operation-row"]')].find((element) =>
        (element.textContent ?? "").includes(${JSON.stringify(label)}),
      );

      if (found !== undefined) {
        window.__e2eHeights.push(found.clientHeight);
      }

      if (!window.__e2eStop) {
        requestAnimationFrame(sample);
      }
    };

    requestAnimationFrame(sample);
  })()`);

  return {
    read: async () => Schema.decodeUnknownSync(Heights)(await page.evaluate("window.__e2eHeights")),
    stop: () => page.evaluate("window.__e2eStop = true"),
  };
}

for (const reduced of [false, true]) {
  const how = reduced ? "under reduced motion, it is gone at once" : "it folds in 200 ms";

  test(`motion: the line accepted folds away from the list; ${how}`, async ({
    page,
    app,
    user,
  }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    await reviewer(page, app, user, reduced ? "zelie" : "lisandro");
    await openReview(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    await row(page, GYM.label).getByRole("button").click();
    await expect(proposalOf(page, GYM.label)).toBeVisible();
    await animationsDone(page);

    const heights = await sampleRowHeights(page, GYM.label);

    await proposalOf(page, GYM.label)
      .getByRole("button", { name: `Accept the proposal for ${GYM.label}` })
      .click();
    await expect(row(page, GYM.label)).toHaveCount(0);
    await heights.stop();

    const folding = (await heights.read()).filter((height) => height > 0 && height < 47);

    if (reduced) {
      // From whole to gone, nothing between.
      expect(folding).toEqual([]);
    } else {
      // Frames drawn on its way to nothing.
      expect(folding.length).toBeGreaterThan(0);
    }

    await animationsDone(page);
  });
}

test("on a phone, the line opens in a sheet and Correct's dialog rises from the bottom", async ({
  page,
  app,
  user,
}) => {
  test.skip(!onPhone(page), "On a wide screen the detail opens beside the list");

  await reviewer(page, app, user, "timeo");
  await openReview(page);
  await row(page, GROCER.label).getByRole("button").click();

  const sheet = page.getByRole("dialog", { name: GROCER.label, exact: true });

  await expect(sheet.locator('[data-slot="review-proposal"]')).toBeVisible();
  await sheet.getByRole("button", { name: `Correct ${GROCER.label}` }).click();

  const dialog = page.getByRole("dialog", { name: "Correct this line" });

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("transition-duration", "0.3s");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await animationsDone(page);
});
