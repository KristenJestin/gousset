import { writeFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";
import { account, importProfile, statementImport } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";
import { and, eq } from "drizzle-orm";

import { addUser } from "../src/auth";
import { onPhone } from "../src/frame";
import { animationsDone, expect, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #19, the import screen's CSV preview: a CSV file detection could not read whole waits, its
// card saying so with an action that opens its first lines in a side sheet (#210); there the user
// chooses a profile or maps each column, sees a test read, saves the mapping as a profile, shares a
// profile as a file, and imports. Each test has a user of its own, with one account in euros, so
// that no other test's profiles or lines meet its own.

const ACCOUNT = "Everyday account";

/** A user of the test's own, signed in on `page`, with one account; the user's id. */
async function importer(
  app: { baseURL: string; database: string; slot: number },
  admin: Parameters<typeof addUser>[1],
  page: Page,
  name: string,
): Promise<string> {
  const person = await addUser(app.baseURL, admin, {
    name: "Sam Example",
    email: `sam.${name}.worker${String(app.slot)}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-sam-password-${String(app.slot)}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    await data.asUser(owner, (transaction) =>
      transaction
        .insert(account)
        .values({ userId: owner, name: ACCOUNT, kind: "current", currency: "EUR" }),
    );

    await page.context().addCookies([...person.cookies]);

    return owner;
  } finally {
    await data.close();
  }
}

/** A header no shipped profile has: an upload cannot tell its profile, nor its days' order. */
const HEADER = "Date;Valeur;Libellé;Débit;Crédit";

/**
 * An invented French export in Windows-1252, three lines above its table, whose days are all the
 * 12th or before: detection cannot tell the day from the month, and the import waits for the user.
 */
async function frenchExport(testInfo: TestInfo, fileName: string, day: string) {
  const path = testInfo.outputPath(fileName);

  await writeFile(
    path,
    encodeWindows1252(
      [
        "Relevé de compte",
        "Compte courant",
        `Période du ${day}/12/2026 au 12/12/2026`,
        HEADER,
        `${day}/12/2026;${day}/12/2026;"CB MARCHÉ DES HALLES";18,40;`,
        `${day}/12/2026;${day}/12/2026;"VIR SEPA DOMINIQUE EXEMPLE";;75,00`,
        "",
      ].join("\r\n"),
    ),
  );

  return path;
}

const drop = (page: Page, path: string) =>
  page.locator('[data-slot="file-drop-input"]').setInputFiles(path);

/** Chooses an option of a list named `list`, as a user does. */
async function choose(page: Page, list: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: list }).click();
  await page.getByRole("option", { name: option }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

/** Says which account the file just dropped goes to. */
async function chooseAccount(page: Page, file: string) {
  await expect(page.getByRole("cell", { name: "Account to choose" })).toBeVisible({
    timeout: 30_000,
  });
  await choose(page, `Account of ${file}`, ACCOUNT);
  await page.getByRole("button", { name: "Import into this account" }).click();
}

/** The card's action that opens the file's columns. */
const confirmColumns = (page: Page) => page.getByRole("button", { name: "Confirm the columns" });

/** The side sheet that holds a file's columns. */
const sheetOf = (page: Page, file: string) =>
  page.getByRole("dialog", { name: `The columns of ${file}` });

/** Drops the file, chooses its account, waits for its columns to confirm, and opens them. */
async function previewOf(page: Page, path: string, file: string) {
  await drop(page, path);
  await chooseAccount(page, file);
  await expect(page.getByRole("cell", { name: "Columns to confirm" })).toBeVisible({
    timeout: 30_000,
  });
  await confirmColumns(page).click();
  await expect(
    sheetOf(page, file).getByRole("table", { name: `The first lines of ${file}` }),
  ).toBeVisible({ timeout: 30_000 });
}

const testRead = (page: Page) => page.getByRole("region", { name: "Test read" });

/** A file's summary, by its name. */
const summaryOf = (page: Page, file: string) =>
  page.getByRole("region", { name: `What ${file} brought` });

const added = (page: Page, file: string) =>
  summaryOf(page, file).first().locator('[data-figure="added"] dd .sr-only');

/** The profile an import of `fileName` recorded: one of the user's, by its name, or shipped. */
async function profileOfImport(database: string, owner: string, fileName: string) {
  const data = openUserData(database);

  try {
    const [row] = await data.asUser(owner, (transaction) =>
      transaction
        .select({ profile: importProfile.name, shipped: statementImport.shippedProfile })
        .from(statementImport)
        .leftJoin(importProfile, eq(importProfile.id, statementImport.profileId))
        .where(and(eq(statementImport.fileName, fileName), eq(statementImport.status, "done"))),
    );

    return row;
  } finally {
    await data.close();
  }
}

test("a profile made from a preview reads the file", async ({ app, user, page }, testInfo) => {
  test.setTimeout(120_000);

  const owner = await importer(app, user, page, "made");

  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "december.csv", "01"), "december.csv");

  // The days are said to be day first; a column mapped elsewhere leaves the label unmapped.
  await choose(page, "Date format", "DD/MM/YYYY, as in 03/10/2026");
  await choose(page, "What Libellé holds", "Ignored");
  await expect(page.getByText("Say which column holds: Label.")).toBeVisible();

  await choose(page, "What Libellé holds", "Label");
  await expect(testRead(page)).toContainText("CB MARCHÉ DES HALLES");
  await expect(testRead(page)).toContainText("−€18.40");
  await expect(testRead(page)).toContainText("€75.00");

  // Saved without a name, it is refused in the user's words; then named.
  await page.getByRole("button", { name: "Save as a profile" }).click();
  await expect(page.getByText("Give the profile a name.")).toBeVisible();

  await page.getByRole("textbox", { name: "Name of the profile" }).fill("  Market bank ");
  await page.getByRole("button", { name: "Save as a profile" }).click();
  await expect(page.getByText("Saved as Market bank")).toBeVisible();

  await page.getByRole("button", { name: "Read the file this way" }).click();
  await expect(sheetOf(page, "december.csv")).toBeHidden();
  await expect(summaryOf(page, "december.csv")).toBeVisible({ timeout: 30_000 });
  await expect(added(page, "december.csv")).toHaveText("2");

  // The next file with that header is read with the profile, without a preview.
  await drop(page, await frenchExport(testInfo, "december-again.csv", "05"));
  await chooseAccount(page, "december-again.csv");
  await expect(summaryOf(page, "december-again.csv")).toBeVisible({ timeout: 30_000 });
  await expect(added(page, "december-again.csv")).toHaveText("2");

  expect(await profileOfImport(app.database, owner, "december-again.csv")).toEqual({
    profile: "Market bank",
    shipped: null,
  });

  await animationsDone(page);
});

test("a profile exported as a file is imported back and reads the file", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const owner = await importer(app, user, page, "shared");

  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "shared.csv", "02"), "shared.csv");

  // A shipped profile reads this style: chosen, then exported as a file.
  await choose(page, "Read with", "French style: debit and credit columns");
  await expect(testRead(page)).toContainText("VIR SEPA DOMINIQUE EXEMPLE");

  const downloading = page.waitForEvent("download");

  await page.getByRole("button", { name: "Export the profile" }).click();

  const download = await downloading;
  const exported = testInfo.outputPath("french-bank.gousset-profile.json");

  expect(download.suggestedFilename()).toBe(
    "french-style-debit-and-credit-columns.gousset-profile.json",
  );
  await download.saveAs(exported);

  // A file that holds no profile is refused in the user's words.
  const junk = testInfo.outputPath("not-a-profile.json");

  await writeFile(junk, JSON.stringify({ version: 2, separator: "#" }));
  await page.locator('[data-slot="file-button-input"]').setInputFiles(junk);
  await expect(page.getByText("This file holds no profile Gousset reads")).toBeVisible();

  // Imported back under the file's name, it becomes the user's and reads the file.
  await page.locator('[data-slot="file-button-input"]').setInputFiles(exported);
  await expect(page.getByText("french-bank is now one of your profiles.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Read with" })).toContainText("french-bank");
  await expect(testRead(page)).toContainText("CB MARCHÉ DES HALLES");

  await page.getByRole("button", { name: "Read the file this way" }).click();
  await expect(summaryOf(page, "shared.csv")).toBeVisible({ timeout: 30_000 });
  await expect(added(page, "shared.csv")).toHaveText("2");

  expect(await profileOfImport(app.database, owner, "shared.csv")).toEqual({
    profile: "french-bank",
    shipped: null,
  });

  await animationsDone(page);
});

test("choosing a shipped profile reads a file in its style", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const owner = await importer(app, user, page, "shipped");

  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "shipped.csv", "03"), "shipped.csv");

  await choose(page, "Read with", "French style: debit and credit columns");
  await expect(page.getByRole("combobox", { name: "What Débit holds" })).toHaveText("Debit");
  await expect(page.getByRole("combobox", { name: "What Crédit holds" })).toHaveText("Credit");
  await expect(testRead(page)).toContainText("−€18.40");

  await page.getByRole("button", { name: "Read the file this way" }).click();
  await expect(summaryOf(page, "shipped.csv")).toBeVisible({ timeout: 30_000 });
  await expect(added(page, "shipped.csv")).toHaveText("2");

  expect(await profileOfImport(app.database, owner, "shipped.csv")).toEqual({
    profile: null,
    shipped: "fr-debit-credit",
  });

  await animationsDone(page);
});

test("a refused test read names the line and the column", async ({ app, user, page }, testInfo) => {
  test.setTimeout(90_000);

  await importer(app, user, page, "refused");
  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "refused.csv", "04"), "refused.csv");

  // The columns swapped: the label's column read as the booking date, its first value no date.
  await choose(page, "What Date holds", "Label");
  await choose(page, "What Libellé holds", "Booking date");
  await expect(testRead(page)).toContainText(
    "Line 5, column 3: “CB MARCHÉ DES HALLES” cannot be read as Booking date.",
  );
  await expect(page.getByRole("button", { name: "Read the file this way" })).toBeDisabled();
  await animationsDone(page);
});

// Issue #210, "How to verify".
test("a CSV of unknown columns: the card shows its state and action, the sheet holds the form, Escape cancels and the file still waits, confirming imports the lines", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const owner = await importer(app, user, page, "sheet");

  await visit(page, "/import");
  await drop(page, await frenchExport(testInfo, "sheet.csv", "07"));
  await chooseAccount(page, "sheet.csv");

  // The card says where the file stands and offers the action; the form is not in the page.
  await expect(page.getByRole("cell", { name: "Columns to confirm" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(confirmColumns(page)).toBeVisible();
  await expect(page.getByRole("table", { name: "The first lines of sheet.csv" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Read with" })).toHaveCount(0);

  // The sheet holds the whole form, from the right edge, along the bottom on a phone; focus goes
  // to its first field.
  await confirmColumns(page).click();

  const sheet = sheetOf(page, "sheet.csv");

  await expect(sheet).toHaveAttribute("data-side", onPhone(page) ? "bottom" : "right");
  await expect(sheet.getByRole("combobox", { name: "Read with" })).toBeFocused();
  await expect(sheet.getByRole("table", { name: "The first lines of sheet.csv" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Test read" })).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Name of the profile" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^(Cancel|Read the file this way)$/ })).toHaveText(
    ["Cancel", "Read the file this way"],
  );

  // Escape cancels: the sheet closes, focus goes back to the action, and the file still waits.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(confirmColumns(page)).toBeFocused();
  await expect(page.getByRole("cell", { name: "Columns to confirm" })).toBeVisible();

  // Mapped, named and confirmed: the profile is saved, the sheet closes, the lines are imported.
  await confirmColumns(page).click();
  await choose(page, "Date format", "DD/MM/YYYY, as in 03/10/2026");
  await expect(testRead(page)).toContainText("CB MARCHÉ DES HALLES");
  await sheet.getByRole("textbox", { name: "Name of the profile" }).fill("Halles bank");
  await sheet.getByRole("button", { name: "Read the file this way" }).click();
  await expect(sheet).toBeHidden();
  await expect(summaryOf(page, "sheet.csv")).toBeVisible({ timeout: 30_000 });
  await expect(added(page, "sheet.csv")).toHaveText("2");

  expect(await profileOfImport(app.database, owner, "sheet.csv")).toEqual({
    profile: "Halles bank",
    shipped: null,
  });

  await animationsDone(page);
});

test("the columns' sheet slides in from its edge in 300 ms, and is there at once under reduced motion", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  await importer(app, user, page, "sheet-motion");
  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "sliding.csv", "08"), "sliding.csv");

  const sheet = sheetOf(page, "sliding.csv");

  await expect(sheet).toHaveCSS("transition-duration", "0.3s");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await confirmColumns(page).click();
  await expect(sheet).toHaveCSS("transition-duration", "0s");
  await expect(sheet).toHaveCSS("transform", "none");
  await animationsDone(page);
});

test("the preview's motion: a column lights up as it is mapped, at once under reduced motion", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  await importer(app, user, page, "motion");
  await visit(page, "/import");
  await previewOf(page, await frenchExport(testInfo, "motion.csv", "06"), "motion.csv");

  const header = page.locator('[data-slot="csv-mapping"] th[data-column="3"]');

  await expect(header).toHaveCSS("transition-duration", "0.2s");
  await choose(page, "What Libellé holds", "Ignored");
  await expect(header).not.toHaveAttribute("data-mapped");
  await choose(page, "What Libellé holds", "Label");
  await expect(header).toHaveAttribute("data-mapped", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(header).toHaveCSS("transition-duration", "0s");
  await expect(page.locator('[data-slot="csv-test-result"]')).toHaveCSS("opacity", "1");
  await animationsDone(page);
});
