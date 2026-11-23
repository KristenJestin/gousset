import type { Page } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/client";

import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #15's MCP scenario: the `accounts` tool, read only, through the official MCP client and
// the real OAuth flow, on the made-up accounts written into the user's own tables. Other specs of
// the worker may add accounts to the same user: each line is looked for on its own.

let data: ReturnType<typeof openUserData>;

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  await data.seed(await data.ownerOf(user.email));
});

test.afterAll(async () => {
  await data.close();
});

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

/** The text of the tool's answer, and whether it is an error. */
async function callAccounts(client: Client, args: { [key: string]: string }) {
  const result = await client.callTool({ name: "accounts", arguments: args });
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
