import { account, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { Page } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/client";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #15's MCP scenario: the `accounts` tool, read only, through the official MCP client and
// the real OAuth flow, on the made-up accounts written into the user's own tables. Other specs of
// the worker may add accounts to the same user: each line is looked for on its own.

let data: ReturnType<typeof openUserData>;
let owner = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  owner = await data.ownerOf(user.email);
  await data.seed(owner);
});

test.afterAll(async () => {
  await data.close();
});

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

/** The text of the tool's answer, and whether it is an error. */
async function callAccounts(client: Client, args: { [key: string]: string }) {
  return callText(client, "accounts", args);
}

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const AMOUNT = String.raw`-?[\d,]+\.\d\d EUR`;

/** Where a pattern starts in a text, -1 when it is not there. */
const at = (text: string, pattern: string) => text.search(new RegExp(pattern));

test("an MCP client lists the accounts by group with their totals, and shows one account's lines and its check", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  expect(session.client.getInstructions()).toContain("`accounts`");

  const { text, isError } = await callAccounts(session.client, { action: "list" });

  expect(isError).toBe(false);

  // The groups in the page's order, each made-up account in its own, each group with its total.
  const groups = ["Available:", "Restricted:", "Savings and investments:", "Owed:"].map((title) =>
    text.indexOf(title),
  );

  expect(groups.every((start, index) => start >= 0 && start > (groups[index - 1] ?? -1))).toBe(
    true,
  );

  const current = at(
    text,
    String.raw`- Current account \(Riverside Bank\), current account: ${AMOUNT}; statements until 2026-10-31\.`,
  );

  const meal = at(text, String.raw`- MealCard \(MealCard\), benefit account: ${AMOUNT}`);
  const livret = at(text, String.raw`- Livret A \(Riverside Bank\), Livret A: ${AMOUNT}`);
  const pea = at(text, String.raw`- Northbank PEA \(Northbank\), PEA: ${AMOUNT}`);

  expect(current).toBeGreaterThan(groups[0] ?? 0);
  expect(meal).toBeGreaterThan(groups[1] ?? 0);
  expect(livret).toBeGreaterThan(groups[2] ?? 0);
  expect(pea).toBeGreaterThan(groups[2] ?? 0);
  expect(pea).toBeLessThan(groups[3] ?? 0);
  expect(at(text.slice(current, groups[1]), String.raw`\nTotal: ${AMOUNT}`)).toBeGreaterThan(0);
  expect(at(text.slice(pea, groups[3]), String.raw`\nTotal: ${AMOUNT}`)).toBeGreaterThan(0);

  const shown = await callAccounts(session.client, {
    action: "show",
    name: "Current account",
    institution: "Riverside Bank",
  });

  expect(shown.isError).toBe(false);
  expect(shown.text).toContain("Current account (Riverside Bank), current account in EUR");
  expect(shown.text).toMatch(
    new RegExp(String.raw`Balance at the end of \d{4}-\d\d-\d\d: ${AMOUNT}`),
  );
  // The seed writes each statement's closing balance from its own lines: the check agrees.
  expect(shown.text).toMatch(
    new RegExp(String.raw`Check: on 2026-10-31 the statement and Gousset agree, both ${AMOUNT}\.`),
  );
  expect(shown.text).toContain("Last 20 line(s), newest first");
  expect(shown.text).toMatch(
    new RegExp(String.raw`\n- 2026-10-\d\d: ${AMOUNT}, balance ${AMOUNT}, \S`),
  );

  const unknown = await callAccounts(session.client, { action: "show", name: "No such account" });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('A valid call: accounts {"action":"show","name":');
});

// Issue #16's MCP scenario. The MCP client's requests carry no fixed day: the server's own clock
// gives today, so the expiries are far ahead of any day this test runs on.
test("an MCP client shows a benefit account's restricted money, the credits left and what expires when", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  await data.asUser(owner, async (each) => {
    const [created] = await each
      .insert(account)
      .values({
        userId: owner,
        name: "E2E MealCard MCP",
        kind: "benefit",
        institution: "MealCard",
        currency: "EUR",
      })
      .returning({ id: account.id });

    if (created === undefined) {
      throw new Error("The insert returned no row.");
    }

    const line = { userId: owner, accountId: created.id, source: "manual" as const };

    await each.insert(statementLine).values([
      {
        ...line,
        bookedOn: "2026-09-01",
        amountMinor: 10_000,
        label: "MEALCARD CREDIT",
        expiresOn: "2099-12-31",
      },
      {
        ...line,
        bookedOn: "2026-10-01",
        amountMinor: 8000,
        label: "MEALCARD CREDIT",
        expiresOn: "2099-06-30",
      },
      { ...line, bookedOn: "2026-10-15", amountMinor: -3000, label: "E2E BAKERY" },
    ]);
  });

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const shown = await callAccounts(session.client, { action: "show", name: "E2E MealCard MCP" });

  expect(shown.isError).toBe(false);
  // Its money is restricted, apart from the money available: €100 + €80 − €30.
  expect(shown.text).toMatch(/Balance at the end of \d{4}-\d\d-\d\d: 150\.00 EUR/);
  expect(shown.text).toContain(
    "Benefit account: its money is restricted, not counted in the money available.",
  );
  expect(shown.text).toContain("Credits are used oldest first.");

  // The payment came out of September's credit, the oldest.
  const credits = shown.text.indexOf("Credits left, in order of use:");

  const september = shown.text.indexOf(
    "- credited on 2026-09-01, MEALCARD CREDIT: 70.00 EUR left of 100.00 EUR, expires on 2099-12-31.",
  );

  const october = shown.text.indexOf(
    "- credited on 2026-10-01, MEALCARD CREDIT: 80.00 EUR left of 80.00 EUR, expires on 2099-06-30.",
  );

  expect(credits).toBeGreaterThanOrEqual(0);
  expect(september).toBeGreaterThan(credits);
  expect(october).toBeGreaterThan(september);

  // What expires when, soonest first.
  const expiring = shown.text.indexOf("What expires when:");
  const june = shown.text.indexOf("- 2099-06-30: 80.00 EUR expires.");
  const december = shown.text.indexOf("- 2099-12-31: 70.00 EUR expires.");

  expect(expiring).toBeGreaterThanOrEqual(0);
  expect(june).toBeGreaterThan(expiring);
  expect(december).toBeGreaterThan(june);
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

// Issue #124's scenario: an agent sets an account up, imports a statement into it and reads its
// balance, all through the MCP door, with no visit to the accounts page.
test("an MCP client creates an account, imports a file into it and reads its balance", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // The upload waits for the app's import job.
  test.setTimeout(90_000);

  // A user of the test's own: no other test's accounts share its names, nor this statement's IBAN.
  const owner = await addUser(app.baseURL, user, {
    name: "Sam Example",
    email: `sam.accounts.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-sam-password-${app.slot}`,
  });

  await page.context().addCookies([...owner.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  // The statement's own opening balance, so that its closing balance checks out.
  const created = await callAccounts(session.client, {
    action: "create",
    name: "Everyday account",
    kind: "current",
    institution: "Example Bank",
    currency: "EUR",
    opening_balance: "1,234.56",
  });

  expect(created.isError, created.text).toBe(false);
  expect(created.text).toContain("Created Everyday account (Example Bank).");
  expect(created.text).toContain("Opening balance: 1,234.56 EUR.");

  const statement = writeStatement("camt053", exampleStatement);

  const imported = await callText(session.client, "imports", {
    action: "upload",
    file_name: statement.fileName,
    content: statement.contents,
    account: "Everyday account",
  });

  expect(imported.isError, imported.text).toBe(false);
  expect(imported.text).toContain(`Imported ${statement.fileName} into Everyday account`);
  expect(imported.text).toContain("6 lines read: 6 added");

  const shown = await callAccounts(session.client, { action: "show", name: "everyday account" });

  expect(shown.isError, shown.text).toBe(false);
  // 1,234.56 EUR opening, then the six lines: +2,450.00 −4.20 −850.00 −62.37 −12.99 +35.00.
  expect(shown.text).toMatch(
    /Balance at the end of \d{4}-\d\d-\d\d: 2,790\.00 EUR; statements until 2026-10-31\./,
  );
  expect(shown.text).toContain(
    "Check: on 2026-10-31 the statement and Gousset agree, both 2,790.00 EUR.",
  );
  expect(shown.text).toContain("VIR SEPA ACME CONSEIL SALAIRE OCTOBRE");

  const listed = await callAccounts(session.client, { action: "list" });

  expect(listed.text).toContain(
    "- Everyday account (Example Bank), current account: 2,790.00 EUR; statements until 2026-10-31.",
  );
});
