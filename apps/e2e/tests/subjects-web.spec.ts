import type { Locator, Page } from "@playwright/test";
import { attachSubject, createSubject, refuseProposals } from "@gousset/core";
import type { SubjectInput } from "@gousset/core";
import {
  account,
  entryPart,
  entrySubject,
  merchant,
  statementLine,
  subjectEntryRefused,
} from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { onPhone, sheetGone } from "../src/frame";
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

// Issue #37's screens: the subjects page, a subject's page and its sheet, one test per scenario of
// "How to verify", plus their motion. The data's rules are subjects.spec.ts and subject-rules.spec.ts;
// the MCP tool's come with it. Each test has a user of its own: `fullyParallel` runs them in any
// order. Every name, label and amount here is invented.

const TODAY = "2026-11-15";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(async ({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, and its owner id for the rows made beside the pages. */
async function personFor(
  app: { baseURL: string },
  admin: TestUser,
  local: string,
): Promise<{ person: TestUser; owner: string }> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return { person, owner: await data.ownerOf(person.email) };
}

/** The page, signed in as `person`, on the fixed day. */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
  await hydrated(page);
}

/** Once the page's buttons work: a click before is lost (#97). */
async function hydrated(page: Page) {
  await expect(page.locator("button[data-hydrated]").first()).toBeAttached();
}

let files = 0;

/**
 * Expenses imported as the app imports them, in an account of their own: their merchants
 * recognised. Each one's entry, by its label.
 */
async function expenses(
  owner: string,
  lines: ReadonlyArray<{ readonly day: string; readonly minor: number; readonly label: string }>,
): Promise<ReadonlyMap<string, string>> {
  files += 1;

  const accountId = await imports.createAccount(owner, `Account ${files}`);

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: lines.map((line, index) => ({
        bookedOn: line.day,
        amountMinor: -line.minor,
        label: line.label,
        reference: `E2E-SUBJECT-WEB-${files}-${index}`,
      })),
    }),
  );

  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ label: statementLine.label, entryId: entryPart.entryId })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .where(eq(statementLine.accountId, accountId)),
  );

  return new Map(rows.map((row) => [row.label, row.entryId]));
}

function entryOf(entries: ReadonlyMap<string, string>, label: string): string {
  const found = entries.get(label);

  if (found === undefined) {
    throw new Error(`The line ${label} was not imported.`);
  }

  return found;
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

/** A loan account in euros, as the accounts page makes one; its id. */
async function loanAccount(owner: string, name: string): Promise<string> {
  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind: "loan", currency: "EUR" })
      .returning({ id: account.id }),
  );

  if (made === undefined) {
    throw new Error("The loan was not created.");
  }

  return made.id;
}

/** The subjects an expense is attached to. */
async function subjectsOf(owner: string, entryId: string): Promise<ReadonlyArray<string>> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: entrySubject.subjectId })
      .from(entrySubject)
      .where(eq(entrySubject.entryId, entryId)),
  );

  return rows.map((row) => row.id);
}

const tree = (page: Page) => page.getByRole("navigation", { name: "Your subjects" });

/** A subject's row in the tree, by its name. */
const treeRow = (page: Page, name: string) =>
  tree(page)
    .locator('[data-slot="subject-row"]')
    .filter({ has: page.getByText(name, { exact: true }) });

const block = (page: Page, title: string) => page.getByRole("region", { name: title });

const heading = (page: Page) => page.locator('[data-slot="subject-heading"]');

const newSheet = (page: Page) => page.getByRole("dialog", { name: "New subject" });

const proposals = (page: Page) => page.locator('[data-slot="subject-proposal"]');

/** How many proposals are left, as screen readers hear it (the rolling digits are hidden). */
const proposalsCount = (page: Page) =>
  page.locator('[data-slot="proposals-count"] [data-slot="count"] > span').first();

/** Chooses `option` in the select or combobox `name` of `within`. */
async function choose(page: Page, within: Locator, name: string, option: string) {
  await within.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Opens a subject's sheet with its page's "Edit"; the sheet. */
async function edit(page: Page, name: string) {
  await heading(page).getByRole("button", { name: "Edit" }).click();

  const sheet = page.getByRole("dialog", { name: `Edit ${name}` });

  await expect(sheet).toBeVisible();

  return sheet;
}

test("create a subject inside another, with a value and a loan", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-create");

  await subject(owner, { name: "House" });
  await loanAccount(owner, "Harbor Savings loan");
  await as(page, person, "/subjects");

  // The screen opens on the first subject.
  await expect(page).toHaveURL(/\/subjects\/[\da-f-]{36}$/);
  await expect(heading(page)).toContainText("House");

  const opener = tree(page).getByRole("button", { name: "New" });

  await opener.click();

  const sheet = newSheet(page);
  const name = sheet.getByRole("textbox", { name: "Name" });

  // A long form opens on its first field.
  await expect(name).toBeFocused();
  await name.fill("Garden shed");
  await choose(page, sheet, "Inside", "House");
  await sheet.getByRole("checkbox", { name: "Has a value" }).click();
  await sheet.getByRole("textbox", { name: "Estimated value" }).fill("12000");
  await choose(page, sheet, "Linked loan", "Harbor Savings loan");
  await sheet.getByRole("button", { name: "Create the subject" }).click();

  // Accepted: the sheet closes, the focus goes back to "New", the tree has it under House.
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(treeRow(page, "Garden shed")).toHaveAttribute("data-depth", "1");

  await treeRow(page, "Garden shed").click();
  await expect(heading(page)).toContainText("Garden shed");
  await expect(heading(page)).toContainText("has a value");

  const figures = block(page, "Figures");

  await expect(figures.locator('[data-slot="subject-value"]')).toContainText("€12,000");
  await expect(figures.locator('[data-slot="subject-loan"]')).toContainText("Harbor Savings loan");
  await expectAccessible(page);
});

test("create with merchants and attach the past", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-merchants");

  const entries = await expenses(owner, [
    { day: "2026-09-12", minor: 5000, label: "CB FUELSTOP 1209" },
    { day: "2026-10-03", minor: 6200, label: "CB FUELSTOP 0310" },
    { day: "2026-10-04", minor: 900, label: "CB BAKEHOUSE 0410" },
  ]);

  await as(page, person, "/subjects");

  // No subject yet: the screen says what one is for, with the same button.
  await expect(page.getByText("No subject yet")).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();

  const sheet = newSheet(page);

  await sheet.getByRole("textbox", { name: "Name" }).fill("Van");
  await expect(sheet.getByText("Add a merchant to find its past expenses.")).toBeVisible();
  await sheet.getByRole("button", { name: "Merchant", exact: true }).click();

  const picker = sheet.getByRole("combobox", { name: "Merchant to attach" });

  await expect(picker).toBeFocused();
  await picker.pressSequentially("Fuel");
  await page.getByRole("option", { name: "Fuelstop", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Remove Fuelstop" })).toBeVisible();

  // Its past expenses, before saving, and the offer to attach them: ticked, the user named them.
  await expect(sheet.locator('[data-slot="subject-past"]')).toHaveText(
    "2 expenses match (€112.00).",
  );
  await expect(sheet.getByRole("checkbox", { name: "Attach them" })).toBeChecked();
  await sheet.getByRole("button", { name: "Create the subject" }).click();
  await expect(sheet).toBeHidden();

  // The first subject is shown at once.
  await expect(heading(page)).toContainText("Van");
  // The empty state's "New" left with it: the focus goes to the tree's, which took its place.
  await expect(tree(page).getByRole("button", { name: "New" })).toBeFocused();
  await expect(block(page, "Attached automatically")).toContainText("Fuelstop");
  await expect(block(page, "Expenses")).toContainText("2 expenses");
  await expect(block(page, "Figures").locator('[data-slot="subject-cost"]')).toContainText("€112");

  const [van] = await subjectsOf(owner, entryOf(entries, "CB FUELSTOP 0310"));

  expect(van).toBeDefined();
  expect(await subjectsOf(owner, entryOf(entries, "CB FUELSTOP 1209"))).toEqual([van]);
  expect(await subjectsOf(owner, entryOf(entries, "CB BAKEHOUSE 0410"))).toEqual([]);
});

test("a merchant added: the past offered is every merchant's not attached yet", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "subjects-merchants-edit");

  const entries = await expenses(owner, [
    { day: "2026-09-12", minor: 5000, label: "CB FUELSTOP 1209" },
    { day: "2026-10-03", minor: 6200, label: "CB FUELSTOP 0310" },
    { day: "2026-10-05", minor: 30_000, label: "CB TYREHOUSE 0510" },
  ]);

  const [fuelstop] = await data.asUser(owner, (transaction) =>
    transaction.select({ id: merchant.id }).from(merchant).where(eq(merchant.name, "Fuelstop")),
  );

  // Made from Fuelstop without its past; one of its expenses declined since.
  const van = await subject(owner, { name: "Van", merchantIds: [fuelstop?.id ?? ""] });
  const declined = entryOf(entries, "CB FUELSTOP 1209");

  await Effect.runPromise(refuseProposals(owner, van, [declined]).pipe(Effect.provide(data.layer)));
  await as(page, person, `/subjects/${van}`);

  const sheet = await edit(page, "Van");

  await sheet.getByRole("button", { name: "Merchant", exact: true }).click();
  await sheet.getByRole("combobox", { name: "Merchant to attach" }).pressSequentially("Tyre");
  await page.getByRole("option", { name: "Tyrehouse", exact: true }).click();

  // What saving attaches: Tyrehouse's, and Fuelstop's it does not have yet, the declined one aside.
  await expect(sheet.locator('[data-slot="subject-past"]')).toHaveText(
    "2 expenses match (€362.00).",
  );
  await expect(sheet.getByRole("checkbox", { name: "Attach them" })).toBeChecked();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  expect(await subjectsOf(owner, entryOf(entries, "CB FUELSTOP 0310"))).toEqual([van]);
  expect(await subjectsOf(owner, entryOf(entries, "CB TYREHOUSE 0510"))).toEqual([van]);
  expect(await subjectsOf(owner, declined)).toEqual([]);
});

test("edit and move; a cycle is refused under its field", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-edit");
  const house = await subject(owner, { name: "House" });

  await subject(owner, { name: "Garden shed", parentId: house });

  const van = await subject(owner, { name: "Van" });

  await as(page, person, `/subjects/${van}`);

  const sheet = await edit(page, "Van");

  await sheet.getByRole("textbox", { name: "Name" }).fill("Camper van");
  await choose(page, sheet, "Inside", "House");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(heading(page).getByRole("button", { name: "Edit" })).toBeFocused();
  await expect(heading(page)).toContainText("Camper van");
  await expect(treeRow(page, "Camper van")).toHaveAttribute("data-depth", "1");
  // A press over the backdrop is ui-sdk's while the sheet leaves: the tree once it is gone.
  await sheetGone(page);

  // House inside its own shed: refused, said under "Inside", the sheet left open.
  await treeRow(page, "House").click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${house}$`));
  await expect(heading(page)).toContainText("House");

  const moving = await edit(page, "House");

  await choose(page, moving, "Inside", "House > Garden shed");
  await moving.getByRole("button", { name: "Save" }).click();

  const inside = moving.getByRole("combobox", { name: "Inside", exact: true });

  await expect(inside).toHaveAccessibleDescription(
    /A subject cannot go inside itself, nor inside one of its own\./,
  );
  await expect(moving).toBeVisible();
  await expectAccessible(page);
});

/** A trip of July with three expenses in its period, and one after it. */
async function trip(owner: string) {
  const entries = await expenses(owner, [
    { day: "2026-07-04", minor: 42_000, label: "CB ALPINE LODGE 0407" },
    { day: "2026-07-06", minor: 3450, label: "CB SUMMIT CAFE 0607" },
    { day: "2026-07-09", minor: 5210, label: "CB GREENMARKET 0907" },
    { day: "2026-08-02", minor: 4800, label: "CB GREENMARKET 0208" },
  ]);

  const alps = await subject(owner, {
    name: "Alps 2026",
    startsOn: "2026-07-03",
    endsOn: "2026-07-17",
  });

  return { entries, alps };
}

test("a dated subject's proposals are attached only once confirmed", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "subjects-proposals");
  const { entries, alps } = await trip(owner);
  const lodge = entryOf(entries, "CB ALPINE LODGE 0407");

  await as(page, person, `/subjects/${alps}`);

  const confirm = block(page, "To confirm");

  // Proposed, none attached, none selected.
  await expect(proposalsCount(page)).toHaveText("3");
  await expect(proposals(page)).toHaveCount(3);

  for (const box of await confirm.getByRole("checkbox").all()) {
    await expect(box).not.toBeChecked();
  }

  await expect(block(page, "Expenses")).toContainText("0 expenses");
  expect(await subjectsOf(owner, lodge)).toEqual([]);

  // One by one: it folds away, the count goes down, it is attached.
  await confirm.getByRole("button", { name: /^Attach .*Alpine Lodge/i }).click();
  await expect(proposals(page)).toHaveCount(2);
  await expect(proposalsCount(page)).toHaveText("2");
  await expect.poll(async () => subjectsOf(owner, lodge)).toEqual([alps]);

  // By a selection.
  await confirm.getByRole("checkbox", { name: /^Select .*Summit Cafe/i }).click();
  await confirm.getByRole("button", { name: "Attach selected" }).click();
  await expect(proposals(page)).toHaveCount(1);

  // All at once.
  await confirm.getByRole("button", { name: "Attach all" }).click();
  await expect(proposals(page)).toHaveCount(0);
  await expect(confirm).toContainText("Nothing to confirm");
  await expect(block(page, "Expenses")).toContainText("3 expenses");
  expect(await subjectsOf(owner, entryOf(entries, "CB GREENMARKET 0208"))).toEqual([]);
});

test("a declined proposal stays declined after a reload", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-declined");
  const { entries, alps } = await trip(owner);
  const groceries = entryOf(entries, "CB GREENMARKET 0907");

  await as(page, person, `/subjects/${alps}`);
  await block(page, "To confirm")
    .getByRole("button", { name: /^Not for this subject: .*Greenmarket/i })
    .click();
  await expect(proposals(page)).toHaveCount(2);
  await expect(proposalsCount(page)).toHaveText("2");

  await expect
    .poll(async () =>
      data.asUser(owner, (transaction) =>
        transaction
          .select({ entryId: subjectEntryRefused.entryId })
          .from(subjectEntryRefused)
          .where(eq(subjectEntryRefused.subjectId, alps)),
      ),
    )
    .toEqual([{ entryId: groceries }]);

  await page.reload();
  await hydrated(page);
  await expect(proposals(page)).toHaveCount(2);
  await expect(proposals(page).filter({ hasText: "Greenmarket" })).toHaveCount(0);
  expect(await subjectsOf(owner, groceries)).toEqual([]);
});

test("a parent counts an expense of its child once", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-once");

  const entries = await expenses(owner, [
    { day: "2026-10-08", minor: 21_500, label: "CB TIMBERYARD 0810" },
  ]);

  const house = await subject(owner, { name: "House" });
  const shed = await subject(owner, { name: "Garden shed", parentId: house });
  const planks = entryOf(entries, "CB TIMBERYARD 0810");

  // Attached to the shed and to the house: the house counts it once.
  await attach(owner, shed, [planks]);
  await attach(owner, house, [planks]);
  await as(page, person, `/subjects/${house}`);

  await expect(block(page, "Figures").locator('[data-slot="subject-cost"]')).toContainText("€215");
  await expect(block(page, "Expenses")).toContainText("1 expense");
  await expect(block(page, "Inside it")).toContainText("Garden shed");
  await expect(block(page, "Inside it")).toContainText("€215");
});

test("the period choice", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-period");

  const entries = await expenses(owner, [
    { day: "2025-10-12", minor: 5000, label: "CB FUELSTOP 1210" },
    { day: "2026-10-03", minor: 6200, label: "CB FUELSTOP 0310" },
  ]);

  const van = await subject(owner, { name: "Van" });

  await attach(owner, van, [...entries.values()]);
  await as(page, person, `/subjects/${van}`);

  const cost = block(page, "Figures").locator('[data-slot="subject-cost"]');

  await expect(cost).toContainText("cost in 2026");
  await expect(cost).toContainText("€62");

  await choose(page, heading(page), "Period", "2025");
  await expect(page).toHaveURL(/period=2025/);
  await expect(cost).toContainText("cost in 2025");
  await expect(cost).toContainText("€50");

  await choose(page, heading(page), "Period", "All time");
  await expect(page).toHaveURL(/period=all/);
  await expect(cost).toContainText("cost, all time");
  await expect(cost).toContainText("€112");
  await expect(block(page, "Expenses")).toContainText("2 expenses");

  // The link to the operations names the subject.
  await expect(
    block(page, "Expenses").getByRole("link", { name: "See them in Operations" }),
  ).toHaveAttribute("href", new RegExp(`subject=${van}`));
});

test("archive", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "subjects-archive");
  const dog = await subject(owner, { name: "Dog" });

  await subject(owner, { name: "Van" });
  await as(page, person, `/subjects/${dog}`);

  const sheet = await edit(page, "Dog");

  await sheet.getByRole("checkbox", { name: "Archived" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(heading(page)).toContainText("archived");
  await expect(treeRow(page, "Dog")).toHaveAttribute("data-archived", "");
  await expect(treeRow(page, "Dog")).toContainText("archived");

  // Restored the same way.
  const again = await edit(page, "Dog");

  await again.getByRole("checkbox", { name: "Archived" }).click();
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again).toBeHidden();
  await expect(treeRow(page, "Dog")).not.toHaveAttribute("data-archived");
});

test("the accessibility check: a subject's page with every block, then its sheet", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "subjects-axe");
  const { entries, alps } = await trip(owner);
  const loan = await loanAccount(owner, "Harbor Savings loan");

  const house = await subject(owner, {
    name: "House",
    valueMinor: 32_000_000,
    valueCurrency: "EUR",
    loanAccountId: loan,
    accountIds: [loan],
  });

  await subject(owner, { name: "Garden shed", parentId: house });
  await attach(owner, house, [entryOf(entries, "CB GREENMARKET 0208")]);

  // Every block of a subject with a value, a loan, an account and a child: `visit` checks it.
  await as(page, person, `/subjects/${house}`);
  await expect(block(page, "Inside it")).toContainText("Garden shed");
  await expect(block(page, "Linked accounts")).toContainText("Harbor Savings loan");

  // Its sheet open, every option shown.
  await edit(page, "House");
  await animationsDone(page);
  await expectAccessible(page);
  await page.keyboard.press("Escape");

  // A dated one, its proposals; the end of the test checks it too.
  await visit(page, `/subjects/${alps}`);
  await expect(proposals(page)).toHaveCount(3);
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

/** Where the sheet's surface is, "left,top", or "none". */
const SHEET_BOX = `() => {
  const sheet = document.querySelector('[data-slot="dialog-content"]');
  const box = sheet?.getBoundingClientRect();

  return box === undefined ? "none" : Math.round(box.left) + "," + Math.round(box.top);
}`;

/** The longest transition of the sheet's part `slot`, in seconds, as the browser computes it. */
async function transitionSeconds(page: Page, slot: string) {
  const durations = await page
    .locator(`[data-slot="${slot}"]`)
    .evaluate((node) => getComputedStyle(node).transitionDuration);

  return Math.max(...durations.split(",").map((value) => Number.parseFloat(value)));
}

test("on a phone, the sheet comes from the bottom", async ({ page, app, user }) => {
  test.skip(!onPhone(page), "A phone's width only");

  const { person, owner } = await personFor(app, user, "subjects-phone");

  await subject(owner, { name: "Van" });
  await as(page, person, "/subjects");

  // The tree first, the subject's page under it.
  const treeBox = await tree(page).boundingBox();
  const headingBox = await heading(page).boundingBox();

  expect(headingBox?.y ?? 0).toBeGreaterThan((treeBox?.y ?? 0) + (treeBox?.height ?? 0) - 1);

  const frames = await sample(page, SHEET_BOX);

  await tree(page).getByRole("button", { name: "New" }).click();
  await expect(newSheet(page)).toBeVisible();
  await animationsDone(page);

  const seen = (await frames.stop()).filter((frame) => frame !== "none");
  const [restLeft = 0, restTop = 0] = (seen.at(-1) ?? "0,0").split(",").map(Number);
  const viewport = page.viewportSize();
  const box = await page.locator('[data-slot="dialog-content"]').boundingBox();

  // Along the bottom edge, its whole width, rising from below where it rests.
  expect(restLeft).toBe(0);
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
  expect(seen.filter((frame) => Number(frame.split(",")[1]) > restTop + 1).length).toBeGreaterThan(
    1,
  );
});

for (const reduced of [false, true]) {
  const how = reduced ? "cut under reduced motion" : "in full";

  test(`motion: the sheet slides in, a proposal folds away, the amounts roll; ${how}`, async ({
    page,
    app,
    user,
  }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    const { person, owner } = await personFor(app, user, `subjects-motion-${String(reduced)}`);
    const { entries, alps } = await trip(owner);

    const before = await expenses(owner, [
      { day: "2025-06-01", minor: 3000, label: "CB FUELSTOP 0106" },
    ]);

    // One expense in 2026, another the year before: all time costs more than 2026.
    await attach(owner, alps, [
      entryOf(entries, "CB GREENMARKET 0208"),
      entryOf(before, "CB FUELSTOP 0106"),
    ]);
    await as(page, person, `/subjects/${alps}`);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    // The sheet: from the right edge on a wide screen, the bottom on a phone, over its backdrop.
    const frames = await sample(page, SHEET_BOX);

    await tree(page).getByRole("button", { name: "New" }).click();
    await expect(newSheet(page)).toBeVisible();
    expect(await transitionSeconds(page, "dialog-content")).toBe(reduced ? 0 : 0.3);
    expect(await transitionSeconds(page, "dialog-backdrop")).toBe(reduced ? 0 : 0.2);
    await animationsDone(page);

    const seen = (await frames.stop()).filter((frame) => frame !== "none");
    const [restLeft = 0, restTop = 0] = (seen.at(-1) ?? "0,0").split(",").map(Number);

    const away = seen.filter((frame) => {
      const [left = 0, top = 0] = frame.split(",").map(Number);

      return onPhone(page) ? top > restTop + 1 : left > restLeft + 1;
    });

    if (reduced) {
      expect(away).toEqual([]);
    } else {
      expect(away.length).toBeGreaterThan(1);
    }

    await page.keyboard.press("Escape");
    await expect(newSheet(page)).toBeHidden();
    await animationsDone(page);

    // A proposal declined folds away: it fades while it leaves, or is gone at once.
    const leaving = await sample(
      page,
      `() => {
        const row = [...document.querySelectorAll('[data-slot="subject-proposal"]')].find((each) =>
          (each.textContent ?? "").includes("Summit"),
        );

        return row === undefined ? "gone" : getComputedStyle(row).opacity;
      }`,
    );

    await block(page, "To confirm")
      .getByRole("button", { name: /^Not for this subject: .*Summit Cafe/i })
      .click();
    await expect(proposals(page).filter({ hasText: "Summit" })).toHaveCount(0);
    await animationsDone(page);

    const fading = (await leaving.stop()).filter(
      (opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1,
    );

    if (reduced) {
      expect(fading).toEqual([]);
    } else {
      expect(fading.length).toBeGreaterThan(1);
    }

    // Changing the period: the cost's digits roll from one value to the next, each an animation of
    // its own (Motion's, on the page's animations); none under reduced motion.
    const rolling = await sample(
      page,
      `() => String(document.getAnimations().some((animation) => {
        const target = animation.effect?.target;

        return target instanceof Element && target.closest('[data-slot="subject-cost"] [data-slot="rolling-digit"]') !== null && animation.playState === "running";
      }))`,
    );

    await choose(page, heading(page), "Period", "All time");
    await expect(block(page, "Figures").locator('[data-slot="subject-cost"]')).toContainText(
      "cost, all time",
    );
    await animationsDone(page);

    const rolled = (await rolling.stop()).filter((moving) => moving === "true");

    if (reduced) {
      expect(rolled).toEqual([]);
    } else {
      expect(rolled.length).toBeGreaterThan(1);
    }
  });
}
