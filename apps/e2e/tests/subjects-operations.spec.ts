import type { Locator, Page } from "@playwright/test";
import { attachSubject, createSubject, editSubject } from "@gousset/core";
import type { SubjectInput } from "@gousset/core";
import { entryPart, entrySubject, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { detailAtRest, lineDetail, onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { block, monthSwitcher } from "../src/review";
import {
  addUser,
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #37 where the subjects meet the money: the operations' filter and column, a line's detail
// and its split, an account's lines, and the review's "by subject". One test per scenario, plus
// the phone and the motion. Each test has a user of its own: `fullyParallel` runs them in any
// order. Every name, label and amount here is invented.

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

/** A user of the test's own, and its owner id for the rows made beside the pages. */
async function personFor(app: { baseURL: string }, admin: TestUser, local: string) {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return { person, owner: await data.ownerOf(person.email) };
}

/** The page, signed in as `person`, on the fixed day. */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

let files = 0;

/** A line imported, by its label: its own id and its entry's. */
type Imported = { readonly lineId: string; readonly entryId: string };

/**
 * Lines imported as the app imports them, in an account of their own (money out negative); each
 * one's ids by its label, and the account's.
 */
async function imported(
  owner: string,
  lines: ReadonlyArray<{ readonly day: string; readonly minor: number; readonly label: string }>,
) {
  files += 1;

  const accountId = await imports.createAccount(owner, `Account ${files}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: lines.map((line, index) => ({
        bookedOn: line.day,
        amountMinor: line.minor,
        label: line.label,
        reference: `E2E-SUBJECT-OPS-${files}-${index}`,
      })),
    }),
  );

  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ label: statementLine.label, lineId: statementLine.id, entryId: entryPart.entryId })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .where(eq(statementLine.accountId, accountId)),
  );

  const byLabel = new Map(rows.map((row) => [row.label, row]));

  return {
    accountId,
    of: (label: string): Imported => {
      const found = byLabel.get(label);

      if (found === undefined) {
        throw new Error(`The line ${label} was not imported.`);
      }

      return found;
    },
  };
}

/** A subject made as the sheet makes one; its id. */
async function subject(owner: string, input: SubjectInput): Promise<string> {
  const made = await Effect.runPromise(
    createSubject(owner, input).pipe(Effect.provide(data.layer)),
  );

  return made.id;
}

async function attach(owner: string, subjectId: string, entryIds: ReadonlyArray<string>) {
  await Effect.runPromise(
    attachSubject(owner, subjectId, entryIds).pipe(Effect.provide(data.layer)),
  );
}

async function archive(owner: string, subjectId: string, archived: boolean) {
  await Effect.runPromise(
    editSubject(owner, subjectId, { archived }).pipe(Effect.provide(data.layer)),
  );
}

/** The subjects of each of a line's entries (its shares), in no particular order: sorted. */
async function subjectsOfLine(
  owner: string,
  lineId: string,
): Promise<ReadonlyArray<ReadonlyArray<string>>> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({
        entryId: entryPart.entryId,
        minor: entryPart.amountMinor,
        subjectId: entrySubject.subjectId,
      })
      .from(entryPart)
      .leftJoin(entrySubject, eq(entrySubject.entryId, entryPart.entryId))
      .where(eq(entryPart.lineId, lineId))
      .orderBy(asc(entrySubject.subjectId)),
  );

  const byEntry = new Map<string, Array<string>>();

  for (const row of rows) {
    const own = byEntry.get(row.entryId) ?? [];

    byEntry.set(row.entryId, row.subjectId === null ? own : [...own, row.subjectId]);
  }

  return [...byEntry.values()].toSorted((a, b) => a.join().localeCompare(b.join()));
}

/** The shares' subjects as `subjectsOfLine` gives them: sorted. */
const sharesOf = (...shares: ReadonlyArray<ReadonlyArray<string>>) =>
  shares.toSorted((a, b) => a.join().localeCompare(b.join()));

const list = (page: Page) => page.getByRole("list", { name: "Operations" });
const rows = (page: Page) => list(page).getByRole("listitem");
const row = (page: Page, label: string) => rows(page).filter({ hasText: label });
const count = (page: Page) => page.locator('[data-slot="operations-count"]');

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

/** Opens a line's detail by its row, once it stands still, so that a click in it lands (#223). */
async function openLine(page: Page, label: string): Promise<Locator> {
  await row(page, label).getByRole("button").first().click();

  const detail = lineDetail(page, label);

  await expect(detail).toBeVisible();
  await detailAtRest(detail);

  return detail;
}

/**
 * Runs `act` on the filters' fields: on a wide screen, those of the filter row; on a phone, those of
 * the Filters sheet, opened first and closed after, so that the list is in sight again.
 */
async function inFilters(page: Page, act: (fields: Locator) => Promise<void>) {
  const button = page.getByRole("button", { name: /^Filters/ });

  if (!(await button.isVisible())) {
    await act(page.getByRole("group", { name: "Filters" }));

    return;
  }

  await expect(button).toHaveAttribute("data-hydrated", "");
  await button.click();

  const sheet = page.getByRole("dialog", { name: "Filters" });

  await expect(sheet).toBeVisible();
  await act(sheet);
  await sheet.getByRole("button", { name: /^Show / }).click();
  await expect(sheet).toHaveCount(0);
}

/** Chooses `option` in the select or combobox `name` of `within`. */
async function choose(page: Page, within: Locator, name: string, option: string) {
  await within.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Picks a subject in the "+ Add" of `within` (a detail, a share): typed, then chosen with Enter. */
async function addSubject(
  page: Page,
  within: Locator,
  button: string,
  picker: string,
  name: string,
) {
  await within.getByRole("button", { name: button, exact: true }).click();

  const field = within.getByRole("combobox", { name: picker, exact: true });

  await expect(field).toBeFocused();
  await field.pressSequentially(name);
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await field.press("Enter");
}

/** The subject chips a row of the operations shows, their names. */
const rowChips = (page: Page, label: string) =>
  row(page, label).locator('[data-slot="subject-chip"]');

/** A House with its Garden shed, and a Van: three expenses of October, and one for nothing. */
async function houseAndVan(owner: string) {
  const lines = await imported(owner, [
    { day: "2026-10-08", minor: -21_500, label: "CB TIMBERYARD 0810" },
    { day: "2026-10-12", minor: -4800, label: "CB PAINTSHOP 1210" },
    { day: "2026-10-14", minor: -6200, label: "CB FUELSTOP 1410" },
    { day: "2026-10-16", minor: -900, label: "CB BAKEHOUSE 1610" },
  ]);

  const house = await subject(owner, { name: "House" });
  const shed = await subject(owner, { name: "Garden shed", parentId: house });
  const van = await subject(owner, { name: "Van" });

  await attach(owner, shed, [lines.of("CB TIMBERYARD 0810").entryId]);
  await attach(owner, house, [lines.of("CB PAINTSHOP 1210").entryId]);
  await attach(owner, van, [lines.of("CB FUELSTOP 1410").entryId]);

  return { lines, house, shed, van };
}

test("the operations filter on a parent shows its children's expenses", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "subject-ops-filter");
  const { lines, house, shed } = await houseAndVan(owner);

  await as(page, person, "/operations");
  await hydrated(page);
  await expect(count(page)).toHaveText("4 lines");

  // House: its own expense and its shed's; the address keeps it.
  await inFilters(page, (fields) => choose(page, fields, "Subject", "House"));
  await expect(page).toHaveURL(new RegExp(`subject=${house}`));
  await expect(count(page)).toHaveText("2 lines");
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, "CB TIMBERYARD 0810")).toBeVisible();
  await expect(row(page, "CB PAINTSHOP 1210")).toBeVisible();

  // The shed alone, named with its parent.
  await inFilters(page, (fields) => choose(page, fields, "Subject", "House > Garden shed"));
  await expect(page).toHaveURL(new RegExp(`subject=${shed}`));
  await expect(count(page)).toHaveText("1 line");
  await expect(rows(page)).toHaveCount(1);

  // An address opens the same list, its period with it (a subject's page links so).
  await visit(page, `/operations?subject=${house}&from=2026-10-10&to=2026-10-31`);
  await hydrated(page);
  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, "CB PAINTSHOP 1210")).toBeVisible();

  // The column, wide: each row's subjects as chips; none on a line of none.
  await visit(page, "/operations");
  await hydrated(page);

  if (!onPhone(page)) {
    await expect(rowChips(page, "CB TIMBERYARD 0810")).toHaveText(["Garden shed"]);
    await expect(rowChips(page, "CB FUELSTOP 1410")).toHaveText(["Van"]);
    await expect(rowChips(page, "CB BAKEHOUSE 1610")).toHaveCount(0);

    // An account's lines have the column too (docs/wireframes, screen 7).
    await visit(page, `/accounts/${lines.accountId}`);
    await expect(
      page
        .locator('[data-slot="account-lines"] li')
        .filter({ hasText: "CB TIMBERYARD 0810" })
        .locator('[data-slot="subject-chip"]'),
    ).toHaveText(["Garden shed"]);
  }

  await expectAccessible(page);
});

test("adding and removing a subject in the detail", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subject-ops-detail");

  const lines = await imported(owner, [
    { day: "2026-10-14", minor: -6200, label: "CB FUELSTOP 1410" },
  ]);

  const van = await subject(owner, { name: "Van" });
  const alps = await subject(owner, { name: "Alps 2026" });
  const dog = await subject(owner, { name: "Dog" });

  await archive(owner, dog, true);

  const fuel = lines.of("CB FUELSTOP 1410");

  await as(page, person, "/operations");
  await hydrated(page);

  const detail = await openLine(page, "CB FUELSTOP 1410");
  const subjects = detail.getByRole("region", { name: "Subjects" });

  await expect(subjects).toContainText("None yet");

  // "+ Add" offers the subjects in use, an archived one not among them.
  await subjects.getByRole("button", { name: "Add a subject", exact: true }).click();

  const picker = subjects.getByRole("combobox", { name: "Subject to add", exact: true });

  await expect(picker).toBeFocused();
  await picker.click();
  await expect(page.getByRole("option", { name: "Van", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Alps 2026", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Dog", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "Van", exact: true }).click();

  // Its chip, in the detail and on the row, without reopening; the expense has it.
  await expect(subjects.locator('[data-slot="subject-chip"]')).toHaveText(["Van"]);
  await expect.poll(async () => subjectsOfLine(owner, fuel.lineId)).toEqual([[van]]);

  if (!onPhone(page)) {
    await expect(rowChips(page, "CB FUELSTOP 1410")).toHaveText(["Van"]);
  }

  // Refused: Alps archived meanwhile; said under the field, the chip gone back.
  await archive(owner, alps, true);
  await addSubject(page, subjects, "Add a subject", "Subject to add", "Alps 2026");
  await expect(subjects).toContainText("This subject is archived");
  await expect(subjects.locator('[data-slot="subject-chip"]')).toHaveText(["Van"]);
  expect(await subjectsOfLine(owner, fuel.lineId)).toEqual([[van]]);

  // Removed: its chip leaves the detail and the row.
  await subjects.getByRole("button", { name: "Remove Van" }).click();
  await expect(subjects.locator('[data-slot="subject-chip"]')).toHaveCount(0);
  await expect.poll(async () => subjectsOfLine(owner, fuel.lineId)).toEqual([[]]);

  if (!onPhone(page)) {
    await expect(rowChips(page, "CB FUELSTOP 1410")).toHaveCount(0);
  }

  await animationsDone(page);
  await expectAccessible(page);
});

test("an income offers no subjects", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subject-ops-income");

  await imported(owner, [
    { day: "2026-10-01", minor: 250_000, label: "SEPA ACME PAYROLL OCT" },
    { day: "2026-10-14", minor: -6200, label: "CB FUELSTOP 1410" },
  ]);

  await subject(owner, { name: "Van" });
  await as(page, person, "/operations");
  await hydrated(page);

  const income = await openLine(page, "SEPA ACME PAYROLL OCT");

  await expect(income.getByRole("region", { name: "Subjects" })).toHaveCount(0);
  await expect(income.getByRole("button", { name: "Add a subject" })).toHaveCount(0);

  // Its split offers categories alone.
  await income.getByRole("button", { name: "Split", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Split across categories" });

  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Subjects 1" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

/** The split's sheet, open on the line's detail. */
async function openSplit(page: Page, detail: Locator) {
  await detail.getByRole("button", { name: "Split", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Split across categories" });

  await expect(sheet).toBeVisible();

  return sheet;
}

/** The share `index` (from 1) of the split's sheet. */
const share = (sheet: Locator, index: number) =>
  sheet.locator('[data-slot="split-share"]').nth(index - 1);

/** Adds a share, its category typed and chosen with Enter (a click on a moving list may miss). */
async function addShare(page: Page, sheet: Locator, index: number, category: string) {
  await sheet.getByRole("button", { name: "Add a category" }).click();

  const field = sheet.getByRole("combobox", { name: `Category ${index}` });

  await field.pressSequentially(category);
  await expect(page.getByRole("option", { name: category, exact: true })).toBeVisible();
  await field.press("Enter");
  await expect(field).toHaveValue(category);
}

test("splitting a line between the Van and the trip, with each share counted in its subject on the subject's page", async ({
  page,
  app,
  user,
}) => {
  test.setTimeout(60_000);

  const { person, owner } = await personFor(app, user, "subject-ops-split");

  const lines = await imported(owner, [
    { day: "2026-07-05", minor: -8000, label: "CB FUELSTOP 0507" },
  ]);

  const van = await subject(owner, { name: "Van" });
  const alps = await subject(owner, { name: "Alps 2026" });
  const fuel = lines.of("CB FUELSTOP 0507");

  await attach(owner, van, [fuel.entryId]);
  await as(page, person, "/operations");
  await hydrated(page);

  const detail = await openLine(page, "CB FUELSTOP 0507");
  const sheet = await openSplit(page, detail);

  // How an expense is shared between subjects, said once; the share starts with the line's.
  await expect(sheet).toContainText("To share an expense between subjects, split it");
  await expect(
    share(sheet, 1)
      .getByRole("group", { name: "Subjects 1" })
      .locator('[data-slot="subject-chip"]'),
  ).toHaveText(["Van"]);

  await sheet.getByRole("textbox", { name: "Amount 1" }).fill("50");
  await addShare(page, sheet, 2, "Groceries");

  // The new share starts with the line's subjects too: the trip's takes the Van's place.
  const second = share(sheet, 2);

  await expect(second.locator('[data-slot="subject-chip"]')).toHaveText(["Van"]);
  await second.getByRole("button", { name: "Remove Van" }).click();
  await addSubject(page, second, "Add a subject to share 2", "Subject for share 2", "Alps 2026");
  await expect(second.locator('[data-slot="subject-chip"]')).toHaveText(["Alps 2026"]);

  // Refused under its share: the trip archived meanwhile; the sheet stays open.
  await archive(owner, alps, true);
  await sheet.getByRole("button", { name: "Save the split" }).click();
  await expect(second).toContainText("An archived subject takes no more expenses");
  await expect(share(sheet, 1)).not.toContainText("An archived subject");
  await expect(sheet).toBeVisible();

  await archive(owner, alps, false);
  await sheet.getByRole("button", { name: "Save the split" }).click();
  await expect(sheet).toBeHidden();

  // Each share with its own subject, in the detail and in the data.
  const shares = detail.getByRole("region", { name: "Split across 2 categories" });

  const shareRow = (amount: string) =>
    shares.locator('[data-slot="expense-share"]').filter({ hasText: amount });

  await expect(shareRow("€50.00").locator('[data-slot="subject-chip"]')).toHaveText(["Van"]);
  await expect(shareRow("€30.00").locator('[data-slot="subject-chip"]')).toHaveText(["Alps 2026"]);
  await expect
    .poll(async () => subjectsOfLine(owner, fuel.lineId))
    .toEqual(sharesOf([van], [alps]));

  // On each subject's page, only its share.
  await visit(page, `/subjects/${van}`);
  await expect(block(page, "Figures").locator('[data-slot="subject-cost"]')).toContainText("€50");
  await visit(page, `/subjects/${alps}`);
  await expect(block(page, "Figures").locator('[data-slot="subject-cost"]')).toContainText("€30");
});

test("a split that leaves the subjects out keeps the line's", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subject-ops-split-kept");

  const lines = await imported(owner, [
    { day: "2026-10-14", minor: -9000, label: "CB FUELSTOP 1410" },
  ]);

  const van = await subject(owner, { name: "Van" });
  const fuel = lines.of("CB FUELSTOP 1410");

  await attach(owner, van, [fuel.entryId]);
  await as(page, person, "/operations");
  await hydrated(page);

  const detail = await openLine(page, "CB FUELSTOP 1410");
  const sheet = await openSplit(page, detail);

  await sheet.getByRole("textbox", { name: "Amount 1" }).fill("60");
  await addShare(page, sheet, 2, "Groceries");
  await sheet.getByRole("button", { name: "Save the split" }).click();
  await expect(sheet).toBeHidden();

  // Both shares are the Van's, as the line was.
  await expect.poll(async () => subjectsOfLine(owner, fuel.lineId)).toEqual([[van], [van]]);

  if (!onPhone(page)) {
    await expect(rowChips(page, "CB FUELSTOP 1410")).toHaveText(["Van"]);
  }
});

/** October's and September's expenses for the house: one on House and Garden shed both. */
async function houseMonths(owner: string) {
  const lines = await imported(owner, [
    { day: "2026-09-20", minor: -10_000, label: "CB PAINTSHOP 2009" },
    { day: "2026-10-08", minor: -21_500, label: "CB TIMBERYARD 0810" },
    { day: "2026-10-12", minor: -10_000, label: "CB PAINTSHOP 1210" },
  ]);

  const house = await subject(owner, { name: "House" });
  const shed = await subject(owner, { name: "Garden shed", parentId: house });
  const planks = lines.of("CB TIMBERYARD 0810").entryId;

  // On the shed and on the house: counted once in the house.
  await attach(owner, shed, [planks, lines.of("CB PAINTSHOP 2009").entryId]);
  await attach(owner, house, [planks, lines.of("CB PAINTSHOP 1210").entryId]);

  return { house, shed };
}

const spending = (page: Page) => block(page, "Where the money goes");

test("the review's Subjects tab counts an expense on House and Garden shed once in House, compares with the previous month, and links to the filtered operations", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "subject-ops-review");
  const { house } = await houseMonths(owner);

  await as(page, person, "/?month=2026-10");
  await spending(page).getByRole("tab", { name: "Subjects" }).click();

  const panel = spending(page).getByRole("tabpanel");
  const subjectRows = panel.getByRole("button");

  // In tree order, the shed under the house; the planks once in House: €215 + €100.
  await expect(subjectRows).toHaveCount(2);
  await expect(subjectRows.nth(0)).toContainText("House");
  await expect(subjectRows.nth(0)).toContainText("€315");
  await expect(subjectRows.nth(1)).toContainText("Garden shed");
  await expect(subjectRows.nth(1)).toContainText("€215");
  await expect(panel.locator('[data-slot="breakdown-row"][data-depth="1"]')).toContainText(
    "Garden shed",
  );
  // No benchmark, and a word on why they do not add up.
  await expect(panel.locator('[data-slot="breakdown-benchmark"]')).toHaveCount(0);
  await expect(panel).toContainText("An expense can count in several subjects");

  // Its detail: against September (the shed's €100 counts in House), and its operations.
  await subjectRows.nth(0).click();

  const detail = spending(page).getByRole("group", { name: "House" });
  const figures = detail.getByRole("list", { name: "House against" }).getByRole("listitem");

  await expect(figures.filter({ hasText: "September" })).toContainText("€100");
  await expect(
    detail.getByRole("figure", { name: "House: spending in October, against September" }),
  ).toBeVisible();

  const link = detail.getByRole("link", { name: "See the month's expenses in Operations" });

  await expect(link).toHaveAttribute("href", new RegExp(`subject=${house}`));
  await link.click();
  await expect(page).toHaveURL(/month=2026-10/);
  await hydrated(page);
  await expect(count(page)).toHaveText("2 lines");
  await expect(row(page, "CB PAINTSHOP 2009")).toHaveCount(0);
});

test("the review's Subjects tab with no subject leads to Subjects", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subject-ops-review-none");

  await imported(owner, [{ day: "2026-10-12", minor: -900, label: "CB BAKEHOUSE 1210" }]);
  await as(page, person, "/?month=2026-10");
  await spending(page).getByRole("tab", { name: "Subjects" }).click();

  const panel = spending(page).getByRole("tabpanel");

  await expect(panel).toContainText("No subject yet");
  await panel.getByRole("link", { name: "Subjects" }).click();
  await expect(page).toHaveURL(/\/subjects/);
});

test("the phone layout", async ({ page, app, user }) => {
  test.skip(!onPhone(page), "A phone's width only");

  const { person, owner } = await personFor(app, user, "subject-ops-phone");

  await houseAndVan(owner);
  await as(page, person, "/operations");
  await hydrated(page);

  // As the category, the subjects leave the narrow list; the filter folds with the others.
  await expect(rowChips(page, "CB TIMBERYARD 0810")).toBeHidden();
  await inFilters(page, (fields) => choose(page, fields, "Subject", "Van"));
  await expect(count(page)).toHaveText("1 line");

  // The detail, from the bottom, has them with "+ Add".
  const detail = await openLine(page, "CB FUELSTOP 1410");
  const subjects = detail.getByRole("region", { name: "Subjects" });

  await expect(subjects.locator('[data-slot="subject-chip"]')).toHaveText(["Van"]);
  await expect(subjects.getByRole("button", { name: "Add a subject" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  // The review's tab, nothing wider than the screen.
  await visit(page, "/?month=2026-10");
  await spending(page).getByRole("tab", { name: "Subjects" }).click();
  await expect(spending(page).getByRole("tabpanel").getByRole("button")).toHaveCount(3);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
  await animationsDone(page);
});

/**
 * Samples, each animation frame until stopped, what `reader` (a page script's function, returning
 * a text) reads. Install before the action that moves what it reads.
 */
async function sample(page: Page, reader: string) {
  await page.evaluate(`(() => {
    window.__e2eFrames = [];
    window.__e2eStop = false;
    const read = ${reader};
    const tick = () => {
      window.__e2eFrames.push(read());

      if (!window.__e2eStop) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  })()`);

  return {
    stop: async () => {
      await page.evaluate("window.__e2eStop = true");

      return Schema.decodeUnknownSync(Schema.Array(Schema.String))(
        await page.evaluate("window.__e2eFrames"),
      );
    },
  };
}

/** The opacity of the detail's chip named `name`, or "gone". */
const chipOpacity = (name: string) => `() => {
  const chip = [...document.querySelectorAll('[role="dialog"] [data-slot="subject-chip"]')].find(
    (each) => (each.textContent ?? "").includes(${JSON.stringify(name)}),
  );

  return chip === undefined ? "gone" : getComputedStyle(chip).opacity;
}`;

/** The width of the second bar of the open tab's rows (the shed's), as drawn. */
const SHED_BAR = `() => {
  const fills = document.querySelectorAll('[role="tabpanel"] [data-slot="breakdown-fill"]');
  const fill = fills[1];

  return fill === undefined ? "none" : fill.getAttribute("width") ?? "none";
}`;

for (const reduced of [false, true]) {
  const how = reduced ? "cut under reduced motion" : "in full";

  test(`motion: a subject's chip fades in and out, the tab's bars move with the month; ${how}`, async ({
    page,
    app,
    user,
  }) => {
    test.setTimeout(60_000);

    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    const { person, owner } = await personFor(app, user, `subject-ops-motion-${String(reduced)}`);

    await houseMonths(owner);
    await subject(owner, { name: "Van" });

    // A line opened: a chip added fades in, removed fades out.
    await as(page, person, "/operations?q=paintshop%201210");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    const detail = await openLine(page, "CB PAINTSHOP 1210");
    const subjects = detail.getByRole("region", { name: "Subjects" });
    const coming = await sample(page, chipOpacity("Van"));

    await addSubject(page, subjects, "Add a subject", "Subject to add", "Van");
    await expect(
      subjects.locator('[data-slot="subject-chip"]').filter({ hasText: "Van" }),
    ).toBeVisible();
    await animationsDone(page);

    const fadingIn = (await coming.stop()).filter(
      (opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1,
    );

    const leaving = await sample(page, chipOpacity("Van"));

    await subjects.getByRole("button", { name: "Remove Van" }).click();
    await expect(
      subjects.locator('[data-slot="subject-chip"]').filter({ hasText: "Van" }),
    ).toHaveCount(0);
    await animationsDone(page);

    const fadingOut = (await leaving.stop()).filter(
      (opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1,
    );

    if (reduced) {
      expect(fadingIn).toEqual([]);
      expect(fadingOut).toEqual([]);
    } else {
      expect(fadingIn.length).toBeGreaterThan(1);
      expect(fadingOut.length).toBeGreaterThan(1);
    }

    // The review's Subjects tab: its selection slides as the other tabs'; changing month, the
    // shed's bar grows from October's share of the house's to September's whole.
    await visit(page, "/?month=2026-10");
    await spending(page).getByRole("tab", { name: "Subjects" }).click();
    await expect(spending(page).getByRole("tabpanel").getByRole("button")).toHaveCount(2);
    await animationsDone(page);

    const bars = await sample(page, SHED_BAR);

    await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();
    await expect(monthSwitcher(page)).toContainText("September 2026");
    await expect(spending(page).getByRole("tab", { name: "Subjects" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await animationsDone(page);

    // October's width, then September's: and in full, the widths on the way between them.
    const widths = [...new Set((await bars.stop()).filter((width) => width !== "none"))];
    const between = widths.slice(1, -1);

    expect(widths.at(-1)).not.toBe(widths.at(0));

    if (reduced) {
      expect(between).toEqual([]);
    } else {
      expect(between.length).toBeGreaterThan(1);
    }
  });
}
