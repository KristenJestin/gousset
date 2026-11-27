import type { Page } from "@playwright/test";
import { attachPayback, attachSubject, createSubject } from "@gousset/core";
import type { SubjectInput } from "@gousset/core";
import { entryPart, statementLine, subject, subjectPayback } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type { TestUser } from "../src/auth";
import { onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { openBlock } from "../src/review";
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

// Issue #217's screens: a subject paid back by someone else, in its sheet and on its page (its
// figures, its state, its payback lines and the lines that may be them), what the user still waits
// for on the subjects page, and a payback line in the operations and the month. One test per
// scenario of "How to verify", plus the refusals and the motion. The rules of the data are
// subject-payback.spec.ts's. Each test has a user of its own. Every name, label and amount here is
// invented.

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

async function personFor(
  app: { baseURL: string },
  admin: TestUser,
  local: string,
): Promise<{ person: TestUser; owner: string }> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));

  return { person, owner: await data.ownerOf(person.email) };
}

/** Once the page's buttons work: a click before is lost (#97). */
async function hydrated(page: Page) {
  await expect(page.locator("button[data-hydrated]").first()).toBeAttached();
}

/** The page, signed in as `person`, on the fixed day. */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
  await hydrated(page);
}

let files = 0;

/**
 * Lines imported as the app imports them, in an account of their own ("Everyday account"): `minor`
 * signed, money out negative. Each line's id and its entry's, by its label.
 */
async function lines(
  owner: string,
  rows: ReadonlyArray<{ readonly day: string; readonly minor: number; readonly label: string }>,
): Promise<ReadonlyMap<string, { readonly lineId: string; readonly entryId: string }>> {
  files += 1;

  const accountId = await imports.createAccount(owner, "Everyday account");

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: rows.map((row, index) => ({
        bookedOn: row.day,
        amountMinor: row.minor,
        label: row.label,
        reference: `E2E-PAYBACK-WEB-${files}-${index}`,
      })),
    }),
  );

  const found = await data.asUser(owner, (transaction) =>
    transaction
      .select({ label: statementLine.label, lineId: statementLine.id, entryId: entryPart.entryId })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .where(eq(statementLine.accountId, accountId)),
  );

  return new Map(found.map((row) => [row.label, { lineId: row.lineId, entryId: row.entryId }]));
}

function idsOf(
  made: ReadonlyMap<string, { readonly lineId: string; readonly entryId: string }>,
  label: string,
) {
  const found = made.get(label);

  if (found === undefined) {
    throw new Error(`The line ${label} was not imported.`);
  }

  return found;
}

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

async function newSubject(owner: string, input: SubjectInput): Promise<string> {
  return (await run(createSubject(owner, input).pipe(Effect.provide(data.layer)))).id;
}

async function attach(owner: string, subjectId: string, entryIds: ReadonlyArray<string>) {
  await run(attachSubject(owner, subjectId, entryIds).pipe(Effect.provide(data.layer)));
}

async function payBack(owner: string, subjectId: string, lineIds: ReadonlyArray<string>) {
  await run(attachPayback(owner, subjectId, lineIds, "EUR").pipe(Effect.provide(data.layer)));
}

/** The lines that pay a subject back, by id. */
async function paybackLinesOf(owner: string, subjectId: string): Promise<ReadonlyArray<string>> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ lineId: subjectPayback.lineId })
      .from(subjectPayback)
      .where(eq(subjectPayback.subjectId, subjectId)),
  );

  return rows.map((row) => row.lineId);
}

/** How many entries a line has: an income's one, none while it pays a subject back. */
async function entriesOf(owner: string, lineId: string): Promise<number> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction.select({ id: entryPart.id }).from(entryPart).where(eq(entryPart.lineId, lineId)),
  );

  return rows.length;
}

const block = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });

const heading = (page: Page) => page.locator('[data-slot="subject-heading"]');

const payback = (page: Page) => block(page, "Paid back");

const figure = (page: Page, slot: "spent" | "paid-back" | "difference") =>
  payback(page).locator(`[data-slot="payback-${slot}"]`);

const state = (page: Page) => payback(page).locator('[data-slot="payback-state"]');

const paybackRows = (page: Page) => payback(page).locator('[data-slot="payback-line"]');

const candidatesSheet = (page: Page) =>
  page.getByRole("dialog", { name: "Lines that may pay it back" });

const candidates = (page: Page) => candidatesSheet(page).locator('[data-slot="payback-candidate"]');

const waiting = (page: Page) => page.getByRole("region", { name: "Waiting to be paid back" });

const waitingRow = (page: Page, name: string) =>
  waiting(page).locator('[data-slot="payback-waiting-row"]').filter({ hasText: name });

/** Opens the lines that may pay the subject back; the sheet. */
async function openCandidates(page: Page) {
  await payback(page).getByRole("button", { name: "Find payback lines" }).click();
  await expect(candidatesSheet(page)).toBeVisible();

  return candidatesSheet(page);
}

/** A work trip of three expenses, paid back by its employer in one larger transfer. */
async function workTrip(owner: string) {
  const made = await lines(owner, [
    { day: "2026-10-05", minor: -12_000, label: "CB RAILWAYS 0510" },
    { day: "2026-10-06", minor: -9935, label: "CB GRAND HOTEL 0610" },
    { day: "2026-10-07", minor: -3250, label: "CB BRASSERIE 0710" },
    { day: "2026-10-20", minor: 91_450, label: "VIR NORTHWIND CONSULTING" },
  ]);

  const trip = await newSubject(owner, { name: "Lyon trip", paybackFrom: "Northwind Consulting" });

  await attach(owner, trip, [
    idsOf(made, "CB RAILWAYS 0510").entryId,
    idsOf(made, "CB GRAND HOTEL 0610").entryId,
    idsOf(made, "CB BRASSERIE 0710").entryId,
  ]);

  return { made, trip, report: idsOf(made, "VIR NORTHWIND CONSULTING") };
}

test("a paid-back subject with three expenses and one larger transfer back shows spent, paid back and the difference", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "payback-trip");
  const { trip, report } = await workTrip(owner);

  await as(page, person, `/subjects/${trip}`);
  await expect(heading(page)).toContainText("paid back");

  // Nothing came back yet: to ask, the whole cost spent.
  await expect(state(page)).toHaveText("To ask");
  await expect(figure(page, "spent")).toContainText("€251.85");
  await expect(figure(page, "paid-back")).toContainText("€0.00");
  await expect(paybackRows(page)).toHaveCount(0);

  // The employer's transfer is offered first, and attached on the user's yes.
  const sheet = await openCandidates(page);

  await expect(candidates(page).first()).toContainText("NORTHWIND CONSULTING");
  await sheet.getByRole("button", { name: /^Attach VIR NORTHWIND CONSULTING/ }).click();
  await expect(candidates(page).filter({ hasText: "NORTHWIND" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // More came back than it cost: the difference is said with its sign, and it is paid back.
  await expect(figure(page, "spent")).toContainText("€251.85");
  await expect(figure(page, "paid-back")).toContainText("€914.50");
  await expect(figure(page, "difference")).toContainText("+€662.65");
  await expect(state(page)).toHaveText("Paid back");
  await expect(paybackRows(page)).toHaveCount(1);
  await expect(paybackRows(page).first()).toContainText("€914.50");
  expect(await paybackLinesOf(owner, trip)).toEqual([report.lineId]);
  expect(await entriesOf(owner, report.lineId)).toBe(0);

  // Paid back, it is not waited for.
  await expect(waitingRow(page, "Lyon trip")).toHaveCount(0);

  // In the month the transfer is no income: a movement that pays the trip back.
  await visit(page, "/?month=2026-10");
  await expect(block(page, "The month")).not.toContainText("€914");

  const movements = await openBlock(page, "Movements");

  await expect(movements).toContainText("Northwind Consulting");
  await expect(movements).toContainText("pays back Lyon trip");

  // In the operations it names the subject it pays back, in place of a category.
  await visit(page, "/operations?month=2026-10");
  // Once hydrated, the list places its rows itself, from script: a press on a row then opens it.
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();

  const row = page
    .locator('[data-slot="operation-row"]')
    .filter({ hasText: "VIR NORTHWIND CONSULTING" });

  await expect(row).toBeVisible();

  if (!onPhone(page)) {
    await expect(row).toContainText("Pays back Lyon trip");
  }

  await row.getByRole("button").first().click();

  const detail = page.locator('[data-slot="line-payback"]');

  await expect(detail).toContainText("Pays back");
  await expect(detail.getByRole("link", { name: "Lyon trip" })).toHaveAttribute(
    "href",
    new RegExp(`/subjects/${trip}`),
  );
});

test("a shared holiday settled in two transfers that cover less than it cost shows partly paid back", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "payback-holiday");

  const made = await lines(owner, [
    { day: "2026-08-03", minor: -60_000, label: "CB LAKE CABIN 0308" },
    { day: "2026-08-04", minor: -18_000, label: "CB CANOE RENTAL 0408" },
    { day: "2026-08-20", minor: 20_000, label: "VIR SAM EXAMPLE CABIN" },
    { day: "2026-09-02", minor: 15_000, label: "VIR SAM EXAMPLE CANOE" },
  ]);

  const holiday = await newSubject(owner, {
    name: "Shared holiday",
    paybackFrom: "Sam Example",
    paybackAskedOn: "2026-08-10",
  });

  await attach(owner, holiday, [
    idsOf(made, "CB LAKE CABIN 0308").entryId,
    idsOf(made, "CB CANOE RENTAL 0408").entryId,
  ]);
  await payBack(owner, holiday, [
    idsOf(made, "VIR SAM EXAMPLE CABIN").lineId,
    idsOf(made, "VIR SAM EXAMPLE CANOE").lineId,
  ]);
  await as(page, person, `/subjects/${holiday}`);

  await expect(state(page)).toHaveText("Partly paid back");
  await expect(figure(page, "spent")).toContainText("€780.00");
  await expect(figure(page, "paid-back")).toContainText("€350.00");
  await expect(figure(page, "difference")).toContainText("−€430.00");
  await expect(paybackRows(page)).toHaveCount(2);
  await expect(payback(page)).toContainText("Sam Example");
});

test("a proposed payback line is attached only on yes, and detached", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "payback-yes");
  const { trip, report } = await workTrip(owner);

  await as(page, person, `/subjects/${trip}`);

  // Offered, not attached: opening the sheet and closing it attaches nothing.
  await openCandidates(page);
  await expect(candidates(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(candidatesSheet(page)).toBeHidden();
  expect(await paybackLinesOf(owner, trip)).toEqual([]);
  expect(await entriesOf(owner, report.lineId)).toBe(1);

  // Yes: attached.
  await openCandidates(page);
  await candidatesSheet(page)
    .getByRole("button", { name: /^Attach VIR NORTHWIND CONSULTING/ })
    .click();
  await expect(candidatesSheet(page)).toContainText("No line coming in could pay it back.");
  await expect.poll(async () => paybackLinesOf(owner, trip)).toEqual([report.lineId]);
  await page.keyboard.press("Escape");
  await expect(candidatesSheet(page)).toBeHidden();
  await expect(paybackRows(page)).toHaveCount(1);

  // Detached from the page: it goes, and the line is an income again, offered once more.
  await payback(page)
    .getByRole("button", { name: /^Detach VIR NORTHWIND CONSULTING/ })
    .click();
  await expect(paybackRows(page)).toHaveCount(0);
  await expect.poll(async () => paybackLinesOf(owner, trip)).toEqual([]);
  expect(await entriesOf(owner, report.lineId)).toBe(1);
  await expect(state(page)).toHaveText("To ask");
  await openCandidates(page);
  await expect(candidates(page)).toHaveCount(1);
});

test("the waiting list shows each subject with its amount", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "payback-waiting");

  const made = await lines(owner, [
    { day: "2026-05-02", minor: -30_000, label: "CB AIRLINE 0205" },
    { day: "2026-05-03", minor: -4000, label: "CB TAXI 0305" },
    { day: "2026-05-04", minor: -12_000, label: "CB GIFT SHOP 0405" },
    { day: "2026-05-05", minor: -8000, label: "CB OLD TRIP 0505" },
    { day: "2026-05-20", minor: 1500, label: "VIR FRIENDS GIFT" },
  ]);

  const conference = await newSubject(owner, {
    name: "Conference",
    paybackFrom: "Example Corp",
    paybackAskedOn: "2026-05-10",
  });

  const clientVisit = await newSubject(owner, {
    name: "Client visit",
    paybackFrom: "Example Corp",
  });

  const gift = await newSubject(owner, { name: "Gift pool", paybackFrom: "Friends" });

  const settled = await newSubject(owner, {
    name: "Old trip",
    paybackFrom: "Example Corp",
    paybackSettledOn: "2026-05-25",
  });

  await attach(owner, conference, [idsOf(made, "CB AIRLINE 0205").entryId]);
  await attach(owner, clientVisit, [idsOf(made, "CB TAXI 0305").entryId]);
  await attach(owner, gift, [idsOf(made, "CB GIFT SHOP 0405").entryId]);
  await attach(owner, settled, [idsOf(made, "CB OLD TRIP 0505").entryId]);
  await payBack(owner, gift, [idsOf(made, "VIR FRIENDS GIFT").lineId]);
  await newSubject(owner, { name: "Van" });
  await as(page, person, `/subjects/${conference}`);

  // To ask first, then asked, then partly; paid back and plain subjects are not there.
  const rows = waiting(page).locator('[data-slot="payback-waiting-row"]');

  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Client visit");
  await expect(rows.nth(0)).toContainText("To ask");
  await expect(rows.nth(0)).toContainText("€40.00");
  await expect(rows.nth(1)).toContainText("Conference");
  await expect(rows.nth(1)).toContainText("Asked on May 10");
  await expect(rows.nth(1)).toContainText("€300.00");
  await expect(rows.nth(2)).toContainText("Gift pool");
  await expect(rows.nth(2)).toContainText("Partly paid back");
  await expect(rows.nth(2)).toContainText("€105.00");
  await expect(waitingRow(page, "Old trip")).toHaveCount(0);
  await expect(waitingRow(page, "Van")).toHaveCount(0);

  // Each row leads to its subject.
  await waitingRow(page, "Gift pool").click();
  await expect(page).toHaveURL(new RegExp(`/subjects/${gift}`));
  await expect(heading(page)).toContainText("Gift pool");
  await expectAccessible(page);
});

/** The subject's row as the database keeps its option. */
async function optionOf(owner: string, subjectId: string) {
  const [row] = await data.asUser(owner, (transaction) =>
    transaction
      .select({
        from: subject.paybackFrom,
        askedOn: subject.paybackAskedOn,
        settledOn: subject.paybackSettledOn,
      })
      .from(subject)
      .where(eq(subject.id, subjectId)),
  );

  return row;
}

/** Opens a subject's sheet with its page's "Edit"; the sheet. */
async function edit(page: Page, name: string) {
  await heading(page).getByRole("button", { name: "Edit" }).click();

  const sheet = page.getByRole("dialog", { name: `Edit ${name}` });

  await expect(sheet).toBeVisible();

  return sheet;
}

test("the option survives an edit, and turning it off clears it", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "payback-option");
  const trip = await newSubject(owner, { name: "Lyon trip" });

  await as(page, person, `/subjects/${trip}`);

  // Turned on, with who pays it back and the day it was asked.
  const sheet = await edit(page, "Lyon trip");

  await sheet.getByRole("checkbox", { name: "Paid back", exact: true }).click();
  await sheet.getByRole("textbox", { name: "Who pays it back" }).fill("Northwind Consulting");

  const asked = sheet.getByRole("textbox", { name: "Asked on" });

  await asked.fill("11/02/2026");
  await asked.press("Tab");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(heading(page)).toContainText("paid back");
  await expect(state(page)).toHaveText("Asked on Nov 2");
  expect(await optionOf(owner, trip)).toEqual({
    from: "Northwind Consulting",
    askedOn: "2026-11-02",
    settledOn: null,
  });

  // Another field edited: the option stays as it was.
  const again = await edit(page, "Lyon trip");

  await expect(again.getByRole("checkbox", { name: "Paid back", exact: true })).toBeChecked();
  await expect(again.getByRole("textbox", { name: "Who pays it back" })).toHaveValue(
    "Northwind Consulting",
  );
  await again.getByRole("textbox", { name: "Name" }).fill("Lyon work trip");
  await again.getByRole("checkbox", { name: "Mark as paid back" }).click();
  await again.getByRole("button", { name: "Save" }).click();
  await expect(again).toBeHidden();
  await expect(state(page)).toHaveText("Paid back");
  expect(await optionOf(owner, trip)).toEqual({
    from: "Northwind Consulting",
    askedOn: "2026-11-02",
    settledOn: TODAY,
  });

  // Turned off: who pays it back and both days are cleared.
  const off = await edit(page, "Lyon work trip");

  await expect(off.getByRole("checkbox", { name: "Mark as paid back" })).toBeChecked();
  await expect(off.getByRole("textbox", { name: "Paid back on" })).toHaveValue("11/15/2026");
  await off.getByRole("checkbox", { name: "Paid back", exact: true }).click();
  await off.getByRole("button", { name: "Save" }).click();
  await expect(off).toBeHidden();
  await expect(heading(page)).not.toContainText("paid back");
  await expect(payback(page)).toHaveCount(0);
  expect(await optionOf(owner, trip)).toEqual({ from: null, askedOn: null, settledOn: null });
});

test("turning the option off while lines pay it back is refused under it", async ({
  page,
  app,
  user,
}) => {
  const { person, owner } = await personFor(app, user, "payback-off-refused");
  const { trip, report } = await workTrip(owner);

  await payBack(owner, trip, [report.lineId]);
  await as(page, person, `/subjects/${trip}`);

  const sheet = await edit(page, "Lyon trip");
  const option = sheet.getByRole("checkbox", { name: "Paid back", exact: true });

  await option.click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(option).toHaveAccessibleDescription(
    /Lines pay this subject back: detach them before turning “paid back” off\./,
  );
  await expect(sheet).toBeVisible();
  expect((await optionOf(owner, trip))?.from).toBe("Northwind Consulting");
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

/** The opacity of the first row of `slot`, or "gone". */
const opacityOf = (slot: string) => `() => {
  const row = document.querySelector('[data-slot="${slot}"]');

  return row === null ? "gone" : getComputedStyle(row).opacity;
}`;

/** Whether a digit of the paid-back figure rolls, as a running animation of the page. */
const ROLLING = `() => String(document.getAnimations().some((animation) => {
  const target = animation.effect?.target;

  return target instanceof Element && target.closest('[data-slot="payback-paid-back"] [data-slot="rolling-digit"]') !== null && animation.playState === "running";
}))`;

/** Frames that are between two values: an opacity strictly between 0 and 1. */
const between = (frames: ReadonlyArray<string>) =>
  frames.filter((opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1);

for (const reduced of [false, true]) {
  const how = reduced ? "cut under reduced motion" : "in full";

  test(`motion: a candidate attached folds away, the amounts roll, a payback line detached folds away; ${how}`, async ({
    page,
    app,
    user,
  }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    const { person, owner } = await personFor(app, user, `payback-motion-${String(reduced)}`);
    const { trip } = await workTrip(owner);

    await as(page, person, `/subjects/${trip}`);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    // The candidate attached fades as it folds away, or is gone at once.
    const sheet = await openCandidates(page);

    await animationsDone(page);

    const leaving = await sample(page, opacityOf("payback-candidate"));
    const rolling = await sample(page, ROLLING);

    await sheet.getByRole("button", { name: /^Attach VIR NORTHWIND CONSULTING/ }).click();
    await expect(candidates(page)).toHaveCount(0);
    await animationsDone(page);

    const fading = between(await leaving.stop());

    if (reduced) {
      expect(fading).toEqual([]);
    } else {
      expect(fading.length).toBeGreaterThan(1);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Paid back moves from €0 to its new value: its digits roll, or change at once.
    await expect(figure(page, "paid-back")).toContainText("€914.50");
    await animationsDone(page);

    const rolled = (await rolling.stop()).filter((moving) => moving === "true");

    if (reduced) {
      expect(rolled).toEqual([]);
    } else {
      expect(rolled.length).toBeGreaterThan(1);
    }

    // The payback line detached folds away the same way.
    const detaching = await sample(page, opacityOf("payback-line"));

    await payback(page)
      .getByRole("button", { name: /^Detach VIR NORTHWIND CONSULTING/ })
      .click();
    await expect(paybackRows(page)).toHaveCount(0);
    await animationsDone(page);

    const folding = between(await detaching.stop());

    if (reduced) {
      expect(folding).toEqual([]);
    } else {
      expect(folding.length).toBeGreaterThan(1);
    }
  });
}
