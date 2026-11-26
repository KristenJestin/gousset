import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Page, TestInfo } from "@playwright/test";
import { DatabaseAccountStore, Today, investmentOperations, investmentsLayer } from "@gousset/core";
import { account, importProfile } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { animationsDone, expect, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 2, on the import screen. Gousset ships no broker's profile: a Fortuneo file is
// read with the library's profile file (`packages/import/profiles/`), imported on the screen and
// shown with its investment account; an unknown broker's file is mapped by hand as operations (its
// columns, its kind words, its formats), saved as a profile of operations and imported; a broker's
// file read on a current account is refused. Each test has a user of its own, with an invented PEA
// and an everyday account. Every amount and ISIN is invented, the ISINs in the country code XX.

const PEA = "Harbour PEA";
const EVERYDAY = "Everyday account";

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, signed in on `page`, with a PEA and an everyday account. */
async function importer(
  app: { baseURL: string; slot: number },
  admin: Parameters<typeof addUser>[1],
  page: Page,
  name: string,
): Promise<{ owner: string; pea: string }> {
  const person = await addUser(app.baseURL, admin, {
    name: "Noor Example",
    email: `noor.${name}.worker${String(app.slot)}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noor-password-${String(app.slot)}`,
  });

  const owner = await data.ownerOf(person.email);

  const [made] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values([
        { userId: owner, name: PEA, kind: "investment", envelope: "pea", currency: "EUR" },
        { userId: owner, name: EVERYDAY, kind: "current", currency: "EUR" },
      ])
      .returning({ id: account.id, name: account.name }),
  );

  await page.context().addCookies([...person.cookies]);

  return { owner, pea: made?.name === PEA ? made.id : "" };
}

/** The operations of the user's PEA, through `@gousset/core`'s reads. */
async function operationsOf(owner: string, pea: string) {
  const page = await Effect.runPromise(
    investmentOperations(owner, pea, { limit: 500 }).pipe(
      Effect.provide(
        Layer.mergeAll(investmentsLayer, DatabaseAccountStore).pipe(Layer.provideMerge(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed("2026-12-31") }),
    ),
  );

  return page.operations.map((each) => [each.kind, each.amount.minor]);
}

const drop = (page: Page, path: string) =>
  page.locator('[data-slot="file-drop-input"]').setInputFiles(path);

/** Chooses an option of a list named `list`, as a user does. */
async function choose(page: Page, list: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: list }).click();
  // Exact: "Fees" is no "Fees' currency", "Amount" no "Amount's currency".
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

/** Drops the file and chooses its account. */
async function dropInto(page: Page, path: string, file: string, accountName: string) {
  await drop(page, path);
  await expect(page.getByRole("cell", { name: "Account to choose" })).toBeVisible({
    timeout: 30_000,
  });
  await choose(page, `Account of ${file}`, accountName);
  await page.getByRole("button", { name: "Import into this account" }).click();
}

const summaryOf = (page: Page, file: string) =>
  page.getByRole("region", { name: `What ${file} brought` });

const figure = (page: Page, file: string, name: string) =>
  summaryOf(page, file).first().locator(`[data-figure="${name}"] dd .sr-only`);

const testRead = (page: Page) => page.getByRole("region", { name: "Test read" });

/** The library's Fortuneo profile file, as a user downloads it from the repository. */
const LIBRARY_FILE = fileURLToPath(
  new URL("../../../packages/import/profiles/operations/fortuneo-operations.json", import.meta.url),
);

/** Imports the library's Fortuneo profile file through the preview's "Import a profile file". */
async function importLibraryProfile(page: Page) {
  await page.locator('[data-slot="file-button-input"]').setInputFiles(LIBRARY_FILE);
  await expect(page.getByText("fortuneo-operations is now one of your profiles.")).toBeVisible();
}

/**
 * An invented Fortuneo export: the header the library's profile guesses (`Date;Opération;
 * Libellé;Code ISIN;Qté;Prix d'exé;Montant brut;Courtage;Montant net;Devise`), a deposit and a
 * purchase, in Windows-1252 with semicolons; its days, the 12th or before, leave detection unsure.
 */
async function fortuneoFile(testInfo: TestInfo, fileName: string) {
  const path = testInfo.outputPath(fileName);

  await writeFile(
    path,
    encodeWindows1252(
      [
        "Date;Opération;Libellé;Code ISIN;Qté;Prix d'exé;Montant brut;Courtage;Montant net;Devise",
        "02/12/2026;Versement espèces;VIREMENT;;;;;;300,00;EUR",
        "03/12/2026;Achat Comptant;FORTUNE WORLD ETF;XX0000000028;10;25,10;-251,00;-1,95;-252,95;EUR",
        "",
      ].join("\r\n"),
    ),
  );

  return path;
}

/**
 * An invented broker no profile knows, in UTF-8 with semicolons, dates with dots and decimal
 * points: a deposit, a purchase and a coupon, each amount's currency beside it. Its days are all
 * the 12th or before, so that detection asks rather than reads it.
 */
async function unknownBroker(testInfo: TestInfo, fileName: string) {
  const path = testInfo.outputPath(fileName);

  await writeFile(
    path,
    [
      "Day;What;ISIN;Name;Units;Price;Fees;Cash;Cur",
      "01.12.2026;Cash in;;;;;;500.00;EUR",
      "02.12.2026;Buy;XX0000000028;NORTHWIND 2030 BOND;10;0.9876;1.00;-10.88;EUR",
      "10.12.2026;Coupon;XX0000000028;NORTHWIND 2030 BOND;;;;0.12;EUR",
      "",
    ].join("\n"),
  );

  return path;
}

/** The preview of a dropped file, once it waits for its columns. */
const preview = (page: Page, file: string) =>
  expect(page.getByRole("table", { name: `The first lines of ${file}` })).toBeVisible({
    timeout: 30_000,
  });

test("a Fortuneo file is read with the library's profile file, imported on the screen", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  const { owner, pea } = await importer(app, user, page, "fortuneo");

  await visit(page, "/import");
  await dropInto(page, await fortuneoFile(testInfo, "fortuneo.csv"), "fortuneo.csv", PEA);
  await preview(page, "fortuneo.csv");

  // No profile of a broker is shipped: the user imports the library's, which is then chosen.
  await importLibraryProfile(page);
  await expect(page.getByRole("combobox", { name: "Read with" })).toContainText(
    "fortuneo-operations",
  );
  await expect(page.getByRole("combobox", { name: "The file holds" })).toContainText(
    "A broker's operations",
  );
  // Its columns are found by their names: the preview shows where the file puts them.
  await expect(page.getByRole("combobox", { name: "What Code ISIN holds" })).toContainText("ISIN");
  await expect(page.getByRole("combobox", { name: "What Devise holds" })).toContainText(
    "Amount's currency",
  );
  await expect(testRead(page)).toContainText("Purchase · FORTUNE WORLD ETF");
  await expect(testRead(page)).toContainText("−€252.95");

  await page.getByRole("button", { name: "Read the file this way" }).click();
  await expect(summaryOf(page, "fortuneo.csv")).toBeVisible({ timeout: 30_000 });
  await expect(summaryOf(page, "fortuneo.csv")).toContainText("Operations read");
  await expect(summaryOf(page, "fortuneo.csv")).toContainText(
    `Read as a broker's operations with fortuneo-operations, into ${PEA}.`,
  );
  await expect(figure(page, "fortuneo.csv", "added")).toHaveText("2");

  expect(await operationsOf(owner, pea)).toEqual([
    ["purchase", -25_295],
    ["deposit", 30_000],
  ]);

  await animationsDone(page);
});

test("map an unknown broker's CSV by hand as operations, save it as a profile, and import it", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(120_000);

  const { owner, pea } = await importer(app, user, page, "by-hand");

  await visit(page, "/import");
  await dropInto(page, await unknownBroker(testInfo, "harbour.csv"), "harbour.csv", PEA);
  await preview(page, "harbour.csv");

  await choose(page, "The file holds", "A broker's operations");
  await choose(page, "Date format", "DD.MM.YYYY, as in 03.10.2026");
  await choose(page, "Decimal mark", "A point, as in 12.34");
  await choose(page, "What Day holds", "Booking date");
  await choose(page, "What What holds", "Kind of operation");
  await choose(page, "What ISIN holds", "ISIN");
  await choose(page, "What Name holds", "Security's name");
  await choose(page, "What Units holds", "Quantity");
  await choose(page, "What Price holds", "Unit price");
  await choose(page, "What Fees holds", "Fees");
  await choose(page, "What Cash holds", "Amount");
  await choose(page, "What Cur holds", "Amount's currency");

  // A word no kind is given yet is refused at its line, never guessed.
  const words = page.getByRole("list", { name: "What each word of What says" });

  await expect(words).toContainText("Cash in");
  await expect(words).toContainText("Buy");
  await expect(words).toContainText("Coupon");
  await expect(testRead(page)).toContainText("Line 2, column 2");

  // Motion: a word lights up once it names a kind, in 200 ms.
  const buy = words.locator("li").filter({ hasText: "Buy" });

  await expect(buy).toHaveCSS("transition-duration", "0.2s");
  await expect(buy).not.toHaveAttribute("data-mapped");

  await choose(page, "What Cash in means", "Deposit");
  await choose(page, "What Buy means", "Purchase");
  await choose(page, "What Coupon means", "Dividend");
  await expect(buy).toHaveAttribute("data-mapped", "true");

  await expect(testRead(page)).toContainText("Purchase · NORTHWIND 2030 BOND");
  await expect(testRead(page)).toContainText("−€10.88");
  await expect(testRead(page)).toContainText("Dividend · NORTHWIND 2030 BOND");

  await page.getByRole("textbox", { name: "Name of the profile" }).fill("Harbour broker");
  await page.getByRole("button", { name: "Save as a profile" }).click();
  await expect(page.getByText("Saved as Harbour broker")).toBeVisible();

  await page.getByRole("button", { name: "Read the file this way" }).click();
  await expect(summaryOf(page, "harbour.csv")).toBeVisible({ timeout: 30_000 });
  await expect(figure(page, "harbour.csv", "added")).toHaveText("3");
  await expect(summaryOf(page, "harbour.csv")).toContainText(
    `Read as a broker's operations with Harbour broker, into ${PEA}.`,
  );

  expect(await operationsOf(owner, pea)).toEqual([
    ["dividend", 12],
    ["purchase", -1088],
    ["deposit", 50_000],
  ]);

  const [saved] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ kind: importProfile.kind, definition: importProfile.definition })
      .from(importProfile)
      .where(eq(importProfile.name, "Harbour broker")),
  );

  expect(saved).toMatchObject({
    kind: "operations",
    definition: {
      version: 2,
      reads: "operations",
      dateFormat: "DD.MM.YYYY",
      decimalMark: ".",
      columns: { bookedOn: 1, kind: 2, amount: 8, amountCurrency: 9 },
      kinds: [
        { word: "Cash in", kind: "deposit" },
        { word: "Buy", kind: "purchase" },
        { word: "Coupon", kind: "dividend" },
      ],
    },
  });

  await animationsDone(page);
});

test("a broker's file read on a current account is refused, saying where it goes", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  await importer(app, user, page, "current");
  await visit(page, "/import");
  await dropInto(page, await fortuneoFile(testInfo, "on-current.csv"), "on-current.csv", EVERYDAY);
  await preview(page, "on-current.csv");
  await importLibraryProfile(page);
  await expect(testRead(page)).toContainText("Purchase · FORTUNE WORLD ETF");
  await page.getByRole("button", { name: "Read the file this way" }).click();

  await expect(
    page.getByText(
      "A broker's operations go into an investment account kept by its lines: choose one.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await animationsDone(page);
});

test("the kind words' motion is cut under reduced motion", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  await importer(app, user, page, "motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page, "/import");
  await dropInto(page, await unknownBroker(testInfo, "motion.csv"), "motion.csv", PEA);
  await preview(page, "motion.csv");

  await choose(page, "The file holds", "A broker's operations");
  await choose(page, "What What holds", "Kind of operation");

  const buy = page
    .getByRole("list", { name: "What each word of What says" })
    .locator("li")
    .filter({ hasText: "Buy" });

  await expect(buy).toHaveCSS("transition-duration", "0s");
  await choose(page, "What Buy means", "Purchase");
  await expect(buy).toHaveAttribute("data-mapped", "true");
  await animationsDone(page);
});
