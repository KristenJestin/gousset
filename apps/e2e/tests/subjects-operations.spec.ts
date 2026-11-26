import type { Locator, Page } from "@playwright/test";
import { attachSubject, createSubject, editSubject } from "@gousset/core";
import type { SubjectInput } from "@gousset/core";
import { entryPart, entrySubject, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { TestUser } from "../src/auth";
import { detailAtRest, lineDetail, onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
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
// and an account's lines. One test per scenario. Each test has a user of its own: `fullyParallel` runs them in any
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
