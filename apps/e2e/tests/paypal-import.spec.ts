import { writeFile } from "node:fs/promises";

import type { Client } from "@modelcontextprotocol/client";
import type { Page, TestInfo } from "@playwright/test";
import { DatabaseLineStore, Today, lineTransferOf, transfersLayer } from "@gousset/core";
import type { LineStore, Transfers } from "@gousset/core";
import { account, entry, entryPart, importProfile, statementLine } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import { exampleStatement, paypalActivity, writeStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Effect, Layer } from "effect";

import type { TestUser } from "../src/auth";
import { lineDetail } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import {
  addUser,
  animationsDone,
  connectMcp,
  expect,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #201, "How to verify": a bank statement whose PayPal lines name nobody, then PayPal's own
// activity imported as an account of its own, through the import job and through the MCP door.
// Each bank line pairs with the money PayPal took from the bank as a transfer; each purchase is an
// expense at its merchant, on the PayPal account; nothing is counted twice. The bank statement and
// the export (`@gousset/fixture`, `paypalActivity`) are invented, but PayPal's name. Each test has
// a user of its own.

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

/** The bank's October: two lines through PayPal, which name no one, and a shop paid by card. */
const BANK_LINES: ReadonlyArray<StatementLine> = [
  { bookedOn: "2026-10-05", amountMinor: -1999, label: "PRLV SEPA PAYPAL EUROPE", reference: "B1" },
  {
    bookedOn: "2026-10-07",
    amountMinor: -2760,
    label: "CB PAYPAL *EXAMPLETRAVEL 05/10",
    reference: "B2",
  },
  { bookedOn: "2026-10-09", amountMinor: -4210, label: "CB GREENMARKET 08/10", reference: "B3" },
];

const bankStatement = {
  ...exampleStatement,
  from: "2026-10-01",
  to: "2026-10-31",
  lines: [...BANK_LINES],
};

/** A new account of the user's in euros, at an institution. */
async function newAccount(owner: string, name: string, institution: string): Promise<string> {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind: "current", currency: "EUR", institution })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

/** The account's lines, oldest first. */
const linesOf = (owner: string, accountId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({
        id: statementLine.id,
        amountMinor: statementLine.amountMinor,
        label: statementLine.label,
        originalAmountMinor: statementLine.originalAmountMinor,
        originalCurrency: statementLine.originalCurrency,
      })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );

/** The id of the account's one line of this amount. */
async function lineOf(owner: string, accountId: string, amountMinor: number): Promise<string> {
  const found = (await linesOf(owner, accountId)).filter(
    (line) => line.amountMinor === amountMinor,
  );

  expect(found, `the line of ${String(amountMinor)}`).toHaveLength(1);

  return found[0]?.id ?? "";
}

/** Each line's entries' kinds: none for a side of a transfer. */
const entriesOf = (owner: string, lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, async (transaction) => {
    const parts = await transaction
      .select({ lineId: entryPart.lineId, kind: entry.kind })
      .from(entryPart)
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .where(inArray(entryPart.lineId, [...lineIds]));

    return lineIds.map((lineId) =>
      parts.flatMap((part) => (part.lineId === lineId ? [part.kind] : [])),
    );
  });

/** What the user's expenses cost, every account together: each payment counted once. */
const spent = (owner: string) =>
  data.asUser(owner, async (transaction) => {
    const parts = await transaction
      .select({ amountMinor: entryPart.amountMinor })
      .from(entryPart)
      .innerJoin(entry, eq(entry.id, entryPart.entryId))
      .where(and(eq(entry.kind, "expense"), eq(entryPart.role, "payment")));

    return parts.reduce((sum, part) => sum + part.amountMinor, 0);
  });

/** The transfers between the user's lines, as out and in pairs. */
const transfersOf = (owner: string, lineIds: ReadonlyArray<string>) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({ out: transfer.outLineId, into: transfer.inLineId })
      .from(transfer)
      .where(
        or(inArray(transfer.outLineId, [...lineIds]), inArray(transfer.inLineId, [...lineIds])),
      ),
  );

/** Runs the transfers' logic on the worker's database, with `TODAY` as today. */
const run = <A, E>(effect: Effect.Effect<A, E, Transfers | LineStore>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(transfersLayer, DatabaseLineStore).pipe(Layer.provide(data.layer)),
      ),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

/** The page, signed in as `person`, on the fixed day, at `path` (checked by axe). */
async function as(page: Page, person: TestUser, path: string) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
  await visit(page, path);
}

test("import an invented bank statement with two PayPal lines, then the invented PayPal export: each bank line is a transfer to PayPal, each purchase an expense at its merchant, nothing counted twice", async ({
  page,
  app,
  user,
}) => {
  test.setTimeout(60_000);

  const person = await addUser(app.baseURL, user, personOfItsOwn("paypal-import"));
  const owner = await data.ownerOf(person.email);
  const everyday = await imports.createAccount(owner, "Everyday");
  const paypal = await newAccount(owner, "PayPal", "PayPal");

  const bank = await imports.importFile(
    owner,
    everyday,
    statementFile("ofx", bankStatement, "everyday-2026-10.ofx"),
  );

  expect(bank.status).toBe("done");

  const funded = await lineOf(owner, everyday, -1999);
  const byCard = await lineOf(owner, everyday, -2760);
  const greenmarket = await lineOf(owner, everyday, -4210);

  // Before PayPal's side is in, the bank's PayPal lines are expenses, as on any account.
  expect(await entriesOf(owner, [funded, byCard])).toEqual([["expense"], ["expense"]]);

  const activity = await imports.importFile(owner, paypal, paypalActivity.english);

  expect(activity.status).toBe("done");
  expect(activity.linesRead).toBe(7);
  expect(activity.linesAdded).toBe(7);
  expect((await imports.profileOf(owner, activity.id))?.shippedProfile).toBe("paypal-activity");

  const pixelPlay = await lineOf(owner, paypal, -1999);
  const fromBank = await lineOf(owner, paypal, 1999);
  const travel = await lineOf(owner, paypal, -2760);
  const fromCard = await lineOf(owner, paypal, 2760);
  const received = await lineOf(owner, paypal, 4825);
  const books = await lineOf(owner, paypal, -1250);
  const refund = await lineOf(owner, paypal, 1250);

  // Each bank line is a transfer to the PayPal account: its other side, the money PayPal took.
  for (const [out, into] of [
    [funded, fromBank],
    [byCard, fromCard],
  ] as const) {
    const { paired } = await run(lineTransferOf(owner, out));

    expect(paired).toMatchObject({
      direction: "out",
      other: { id: into, account: { id: paypal } },
    });
  }

  expect(await transfersOf(owner, [funded, byCard, fromBank, fromCard])).toHaveLength(2);

  // The transfers' sides are no expense; each purchase is one, on the PayPal side; the money
  // received and the refund came in.
  expect(
    await entriesOf(owner, [funded, byCard, fromBank, fromCard, pixelPlay, travel, books]),
  ).toEqual([[], [], [], [], ["expense"], ["expense"], ["expense"]]);

  expect(await entriesOf(owner, [received, refund, greenmarket])).toEqual([
    ["income"],
    ["income"],
    ["expense"],
  ]);

  // Nothing counted twice: what was spent is each purchase once, wherever it was paid from.
  expect(await spent(owner)).toBe(1999 + 2760 + 1250 + 4210);

  // The payment in dollars is the euros its conversion took, the dollars kept beside them.
  expect((await linesOf(owner, paypal)).find((line) => line.id === travel)).toMatchObject({
    label: "Example Travel Ltd",
    originalAmountMinor: -3000,
    originalCurrency: "USD",
  });

  // On the operations page: the purchase names its merchant, asking nothing.
  await as(page, person, `/operations?line=${pixelPlay}`);

  const merchant = page.locator('[data-slot="line-merchant"]');

  await expect(merchant).toHaveAttribute("data-state", "known");
  await expect(merchant).toContainText(/pixel play games/i);
  await expect(merchant).not.toContainText("Who was really paid?");

  // The bank's line is a transfer to PayPal, no expense through an intermediary any more.
  await visit(page, `/operations?line=${funded}`);
  await expect(lineDetail(page, "PRLV SEPA PAYPAL EUROPE")).toContainText("Transfer to PayPal");
});

/**
 * The invented English export cut to the 12th, as a spreadsheet saves it again with semicolons:
 * no profile recognises its header, and its days read day first and month first, so the import
 * waits for the user to say how to read it.
 */
async function semicolonExport(testInfo: TestInfo, fileName: string) {
  const path = testInfo.outputPath(fileName);
  const text = new TextDecoder().decode(paypalActivity.english.bytes);

  await writeFile(path, text.split("\r\n").slice(0, 9).join("\r\n").replaceAll('","', '";"'));

  return path;
}

/** Chooses an option of a list named `list`, as a user does. */
async function choose(page: Page, list: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: list }).click();
  await page.getByRole("option", { name: option }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

// Issue #220: PayPal activity chosen on the import screen keeps reading the file as PayPal's
// activity once a setting is changed and the profile saved.
test("choose PayPal activity on the import screen for an export saved with semicolons: its test read, its saved profile and its import read it as PayPal's activity", async ({
  page,
  app,
  user,
}, testInfo) => {
  test.setTimeout(120_000);

  const person = await addUser(app.baseURL, user, personOfItsOwn("paypal-screen"));
  const owner = await data.ownerOf(person.email);
  const paypal = await newAccount(owner, "PayPal", "PayPal");
  const file = "paypal-semicolons.csv";

  await as(page, person, "/import");
  await page
    .locator('[data-slot="file-drop-input"]')
    .setInputFiles(await semicolonExport(testInfo, file));
  await expect(page.getByRole("cell", { name: "Account to choose" })).toBeVisible({
    timeout: 30_000,
  });
  await choose(page, `Account of ${file}`, "PayPal");
  await page.getByRole("button", { name: "Import into this account" }).click();
  await expect(page.getByRole("table", { name: `The first lines of ${file}` })).toBeVisible({
    timeout: 30_000,
  });

  // PayPal's profile, then the file's separator: the rows read are PayPal's, the payment in
  // dollars by its conversion, named by who was paid.
  await choose(page, "Read with", /^PayPal activity/);
  await choose(page, "Separator", "Semicolon (;)");

  const testRead = page.getByRole("region", { name: "Test read" });

  const paypalRead = async () => {
    await expect(testRead).toContainText("Pixel Play Games");
    await expect(testRead).toContainText("Example Travel Ltd");
    await expect(testRead).toContainText("−€27.60");
  };

  // Read as the plain table its columns say, the dollar purchase is a line in another currency.
  const plainRead = () => expect(testRead).toContainText("Line 4, column 7");

  // The list names what reads the file: PayPal activity, though a setting changed since.
  const readWith = page.getByRole("combobox", { name: "Read with" });

  await paypalRead();
  await expect(readWith).toContainText("PayPal activity");

  // The columns as mapped below, or one of them mapped again: the mapping shown is what reads.
  await choose(page, "Read with", "The columns as mapped below");
  await plainRead();
  await expect(readWith).toContainText("The columns as mapped below");

  await choose(page, "Read with", /^PayPal activity/);
  await choose(page, "Separator", "Semicolon (;)");
  await paypalRead();
  await expect(readWith).toContainText("PayPal activity");

  await choose(page, "What Gross holds", "Amount (signed)");
  await plainRead();
  await expect(readWith).toContainText("The columns as mapped below");

  await choose(page, "Read with", /^PayPal activity/);
  await choose(page, "Separator", "Semicolon (;)");
  await paypalRead();

  await page.getByRole("textbox", { name: "Name of the profile" }).fill("PayPal, semicolons");
  await page.getByRole("button", { name: "Save as a profile" }).click();
  await expect(page.getByText("Saved as PayPal, semicolons")).toBeVisible();

  await page.getByRole("button", { name: "Read the file this way" }).click();

  const summary = page.getByRole("region", { name: `What ${file} brought` }).first();

  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.locator('[data-figure="added"] dd .sr-only')).toHaveText("6");

  // The profile saved reads by PayPal's layout, and the lines are keyed by their transaction id.
  const [saved] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ definition: importProfile.definition })
      .from(importProfile)
      .where(eq(importProfile.name, "PayPal, semicolons")),
  );

  expect(saved?.definition).toMatchObject({ separator: ";", layout: "paypal-activity" });

  const keys = await data.asUser(owner, (transaction) =>
    transaction
      .select({ dedupKey: statementLine.dedupKey })
      .from(statementLine)
      .where(eq(statementLine.accountId, paypal))
      .orderBy(asc(statementLine.dedupKey)),
  );

  expect(keys.map((each) => each.dedupKey)).toEqual(
    [1, 2, 5, 6, 7, 8].map((n) => `bank:0PPEXAMPLE${String(n).padStart(7, "0")}`),
  );

  expect((await linesOf(owner, paypal)).find((line) => line.amountMinor === -2760)).toMatchObject({
    label: "Example Travel Ltd",
    originalAmountMinor: -3000,
    originalCurrency: "USD",
  });

  await animationsDone(page);
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** The id of the import an upload's answer names. */
const importIdOf = (text: string) => /Import id: ([\da-f-]{36})/.exec(text)?.[1] ?? "";

test("an agent imports PayPal's activity through the MCP door, read by the PayPal profile, and its bank lines pair", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  // Two uploads, each waiting for the app's import job.
  test.setTimeout(90_000);

  const person = await addUser(app.baseURL, user, personOfItsOwn("paypal-mcp"));
  const owner = await data.ownerOf(person.email);
  const everyday = await imports.createAccount(owner, "Everyday account");
  const paypal = await newAccount(owner, "PayPal", "PayPal");

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const listed = await callText(session.client, "imports", { action: "profiles" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain(
    "- PayPal activity, shipped with Gousset: PayPal's activity export, its columns found by their names",
  );

  const statement = writeStatement("ofx", bankStatement);

  const bank = await callText(session.client, "imports", {
    action: "upload",
    file_name: "everyday-2026-10.ofx",
    content: statement.contents,
    account: "Everyday account",
  });

  expect(bank.isError, bank.text).toBe(false);
  expect(bank.text).toContain("3 lines read: 3 added");

  const activity = await callText(session.client, "imports", {
    action: "upload",
    file_name: paypalActivity.french.fileName,
    content_base64: Buffer.from(paypalActivity.french.bytes).toString("base64"),
    account: "PayPal",
  });

  expect(activity.isError, activity.text).toBe(false);
  expect(activity.text).toContain("7 lines read: 7 added");

  const profiles = await callText(session.client, "imports", {
    action: "profiles",
    import: importIdOf(activity.text),
  });

  expect(profiles.isError, profiles.text).toBe(false);
  expect(profiles.text).toContain("This import read its file with PayPal activity.");

  // The bank's two PayPal lines are transfers to the PayPal account.
  const bankSide = [await lineOf(owner, everyday, -1999), await lineOf(owner, everyday, -2760)];
  const paypalSide = [await lineOf(owner, paypal, 1999), await lineOf(owner, paypal, 2760)];

  expect(await transfersOf(owner, bankSide)).toEqual(
    expect.arrayContaining([
      { out: bankSide[0], into: paypalSide[0] },
      { out: bankSide[1], into: paypalSide[1] },
    ]),
  );
});
