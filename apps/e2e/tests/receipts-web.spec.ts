import { readFile } from "node:fs/promises";

import type { Locator, Page } from "@playwright/test";
import { attachPayback, attachSubject, createSubject } from "@gousset/core";
import { entryPart, lineAttachment, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { strToU8, unzipSync } from "fflate";

import type { TestUser } from "../src/auth";
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

// Issue #217's receipts on the web: a file attached to a line from its detail, listed there and on
// its subject's page, downloaded alone or with the others in one zip, refused in the dialog when
// too large or of a kind the installation does not take, and deleted once confirmed. This file's
// app takes receipts of 1 MB at most, so that a file over the limit is small. Each test has a user
// of its own; every name, label and amount is invented.
test.use({ appEnvironment: { RECEIPT_MAX_MB: "1" } });

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

/** Invented receipts: each kind's signature, then bytes of nothing in particular. */
function madeUpFile(signature: Uint8Array, size: number): Buffer {
  const file = Buffer.alloc(size);

  file.set(signature);

  for (let at = signature.length; at < size; at += 1) {
    file[at] = (at * 31) % 256;
  }

  return file;
}

const PDF = strToU8("%PDF-1.7\n");
const GIF = strToU8("GIF89a");

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

/**
 * A work trip: a hotel night attached to it, and the employer's transfer that pays it back. The
 * subject's id and each line's, by label.
 */
async function workTrip(owner: string) {
  const accountId = await imports.createAccount(owner, "Everyday account");

  await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", {
      ...exampleStatement,
      lines: [
        { bookedOn: "2026-10-06", amountMinor: -9935, label: "CB GRAND HOTEL 0610" },
        { bookedOn: "2026-10-20", amountMinor: 30_000, label: "VIR NORTHWIND CONSULTING" },
      ].map((line, index) => ({ ...line, reference: `E2E-RECEIPTS-WEB-${owner}-${index}` })),
    }),
  );

  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ label: statementLine.label, lineId: statementLine.id, entryId: entryPart.entryId })
      .from(statementLine)
      .innerJoin(entryPart, eq(entryPart.lineId, statementLine.id))
      .where(eq(statementLine.accountId, accountId)),
  );

  const byLabel = (label: string) => {
    const found = rows.find((row) => row.label === label);

    if (found === undefined) {
      throw new Error(`The line ${label} was not imported.`);
    }

    return found;
  };

  const hotel = byLabel("CB GRAND HOTEL 0610");
  const report = byLabel("VIR NORTHWIND CONSULTING");

  const trip = await Effect.runPromise(
    createSubject(owner, { name: "Lyon trip", paybackFrom: "Northwind Consulting" }).pipe(
      Effect.provide(data.layer),
    ),
  );

  await Effect.runPromise(
    attachSubject(owner, trip.id, [hotel.entryId]).pipe(Effect.provide(data.layer)),
  );
  await Effect.runPromise(
    attachPayback(owner, trip.id, [report.lineId], "EUR").pipe(Effect.provide(data.layer)),
  );

  return { trip: trip.id, hotel, report };
}

/** The receipts kept for a line, by name. */
async function receiptsOf(owner: string, lineId: string): Promise<ReadonlyArray<string>> {
  const rows = await data.asUser(owner, (transaction) =>
    transaction
      .select({ fileName: lineAttachment.fileName })
      .from(lineAttachment)
      .where(eq(lineAttachment.lineId, lineId)),
  );

  return rows.map((row) => row.fileName).toSorted();
}

/** Opens a line's detail from the operations of October; its detail. */
async function openLine(page: Page, label: string) {
  // Once hydrated, the list places its rows itself, from script: a press on a row then opens it.
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
  await page
    .locator('[data-slot="operation-row"]')
    .filter({ hasText: label })
    .getByRole("button")
    .first()
    .click();

  const detail = page.getByRole("dialog", { name: label });

  await expect(detail).toBeVisible();
  await animationsDone(page);

  return detail;
}

const receipts = (detail: Locator) => detail.getByRole("region", { name: "Receipts" });

const attachDialog = (page: Page) => page.getByRole("dialog", { name: "Attach a receipt" });

/** Attaches `file` from the open line's detail, through its dialog; the dialog. */
async function attachFrom(
  page: Page,
  detail: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await receipts(detail).getByRole("button", { name: "Attach a receipt" }).click();

  const dialog = attachDialog(page);

  await expect(dialog).toBeVisible();
  await dialog.locator('[data-slot="file-button-input"]').setInputFiles(file);

  return dialog;
}

const subjectBlock = (page: Page) => page.getByRole("region", { name: "Receipts", exact: true });

test("attaching a receipt shows it on its subject's page", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "receipts-attach");
  const { trip, hotel } = await workTrip(owner);

  await as(page, person, "/operations?month=2026-10");

  const detail = await openLine(page, "CB GRAND HOTEL 0610");

  await expect(receipts(detail)).toContainText("No receipt attached.");

  const dialog = await attachFrom(page, detail, {
    name: "hotel-invoice.pdf",
    mimeType: "application/pdf",
    buffer: madeUpFile(PDF, 200_000),
  });

  // Accepted: the dialog closes, the line lists it with its kind and size, a link that downloads it.
  await expect(dialog).toBeHidden();
  await expect(receipts(detail).locator('[data-slot="line-receipt"]')).toHaveCount(1);
  await expect(receipts(detail)).toContainText("PDF · 0.2 MB");
  await expect(receipts(detail).getByRole("link", { name: "hotel-invoice.pdf" })).toHaveAttribute(
    "href",
    /^\/api\/receipts\//,
  );
  expect(await receiptsOf(owner, hotel.lineId)).toEqual(["hotel-invoice.pdf"]);

  // The subject's page lists it, with its line.
  await visit(page, `/subjects/${trip}`);
  await expect(subjectBlock(page).locator('[data-slot="subject-receipt"]')).toHaveCount(1);
  await expect(subjectBlock(page)).toContainText("hotel-invoice.pdf");
  await expect(subjectBlock(page)).toContainText("CB GRAND HOTEL 0610");
  await expectAccessible(page);
});

test("the zip holds every receipt", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "receipts-zip");
  const { trip } = await workTrip(owner);

  await as(page, person, "/operations?month=2026-10");

  // One on an expense of the trip, one on the line that pays it back.
  for (const [label, name] of [
    ["CB GRAND HOTEL 0610", "hotel-invoice.pdf"],
    ["VIR NORTHWIND CONSULTING", "expense-report.pdf"],
  ] as const) {
    const detail = await openLine(page, label);

    const dialog = await attachFrom(page, detail, {
      name,
      mimeType: "application/pdf",
      buffer: madeUpFile(PDF, 10_000),
    });

    await expect(dialog).toBeHidden();
    await expect(receipts(detail)).toContainText(name);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  }

  await visit(page, `/subjects/${trip}`);
  await expect(subjectBlock(page).locator('[data-slot="subject-receipt"]')).toHaveCount(2);

  const downloading = page.waitForEvent("download");

  await subjectBlock(page).getByRole("link", { name: "Download all" }).click();

  const zip = await downloading;
  const files = unzipSync(new Uint8Array(await readFile(await zip.path())));
  const names = Object.keys(files);

  expect(names).toHaveLength(2);
  expect(names.some((each) => each.endsWith("hotel-invoice.pdf"))).toBe(true);
  expect(names.some((each) => each.endsWith("expense-report.pdf"))).toBe(true);
});

test("a too-large file and a wrong type are refused in the UI", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "receipts-refused");
  const { hotel } = await workTrip(owner);

  await as(page, person, "/operations?month=2026-10");

  const detail = await openLine(page, "CB GRAND HOTEL 0610");

  // Over the installation's 1 MB: refused before a byte is sent, the limit named.
  const dialog = await attachFrom(page, detail, {
    name: "scan.pdf",
    mimeType: "application/pdf",
    buffer: madeUpFile(PDF, 1_200_000),
  });

  await expect(dialog).toContainText("PDF, JPEG, PNG, and HEIC, 1 MB at most.");
  await expect(dialog).toContainText("This file is 1.2 MB; a receipt can be at most 1 MB.");
  await expect(dialog).toBeVisible();

  // A kind the installation does not take, read from its bytes: refused by the server.
  await dialog.locator('[data-slot="file-button-input"]').setInputFiles({
    name: "receipt.gif",
    mimeType: "image/gif",
    buffer: madeUpFile(GIF, 2000),
  });
  await expect(dialog).toContainText("Only PDF, JPEG, PNG, and HEIC files can be attached.");
  await expect(dialog).toBeVisible();
  expect(await receiptsOf(owner, hotel.lineId)).toEqual([]);
});

test("a receipt is deleted once confirmed", async ({ page, app, user }) => {
  const { person, owner } = await personFor(app, user, "receipts-delete");
  const { hotel } = await workTrip(owner);

  await as(page, person, "/operations?month=2026-10");

  const detail = await openLine(page, "CB GRAND HOTEL 0610");

  const dialog = await attachFrom(page, detail, {
    name: "hotel-invoice.pdf",
    mimeType: "application/pdf",
    buffer: madeUpFile(PDF, 10_000),
  });

  await expect(dialog).toBeHidden();

  // Asked first: cancelled, it stays.
  await receipts(detail).getByRole("button", { name: "Delete hotel-invoice.pdf" }).click();

  const confirm = page.getByRole("alertdialog", { name: "Delete this receipt?" });

  await expect(confirm).toContainText("hotel-invoice.pdf is deleted for good");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await receiptsOf(owner, hotel.lineId)).toEqual(["hotel-invoice.pdf"]);

  // Confirmed, it goes.
  await receipts(detail).getByRole("button", { name: "Delete hotel-invoice.pdf" }).click();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(receipts(detail).locator('[data-slot="line-receipt"]')).toHaveCount(0);
  await expect.poll(async () => receiptsOf(owner, hotel.lineId)).toEqual([]);
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

const RECEIPT_OPACITY = `() => {
  const row = document.querySelector('[data-slot="line-receipt"]');

  return row === null ? "gone" : getComputedStyle(row).opacity;
}`;

/** Frames that are between two values: an opacity strictly between 0 and 1. */
const between = (frames: ReadonlyArray<string>) =>
  frames.filter((opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1);

for (const reduced of [false, true]) {
  const how = reduced ? "cut under reduced motion" : "in full";

  test(`motion: a receipt attached fades in, one deleted folds away; ${how}`, async ({
    page,
    app,
    user,
  }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    const { person, owner } = await personFor(app, user, `receipts-motion-${String(reduced)}`);

    await workTrip(owner);
    await as(page, person, "/operations?month=2026-10");
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    const detail = await openLine(page, "CB GRAND HOTEL 0610");
    const coming = await sample(page, RECEIPT_OPACITY);

    const dialog = await attachFrom(page, detail, {
      name: "hotel-invoice.pdf",
      mimeType: "application/pdf",
      buffer: madeUpFile(PDF, 10_000),
    });

    await expect(dialog).toBeHidden();
    await expect(receipts(detail).locator('[data-slot="line-receipt"]')).toHaveCount(1);
    await animationsDone(page);

    const fadingIn = between(await coming.stop());

    if (reduced) {
      expect(fadingIn).toEqual([]);
    } else {
      expect(fadingIn.length).toBeGreaterThan(1);
    }

    const leaving = await sample(page, RECEIPT_OPACITY);

    await receipts(detail).getByRole("button", { name: "Delete hotel-invoice.pdf" }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this receipt?" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(receipts(detail).locator('[data-slot="line-receipt"]')).toHaveCount(0);
    await animationsDone(page);

    const fadingOut = between(await leaving.stop());

    if (reduced) {
      expect(fadingOut).toEqual([]);
    } else {
      expect(fadingOut.length).toBeGreaterThan(1);
    }
  });
}
