import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #24 through the MCP door: the `merchants` tool, called by the official MCP client over the
// real OAuth flow, on lines the `imports` tool brought in, against the built app, its job queue
// and a real Postgres. The user is the test's own, so that no other test's merchants meet these;
// counts are still read from the results.

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: string };

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const ACCOUNT_NAME = "Everyday account";

/** An invented shop under three raw labels: a card payment in town, another, a direct debit. */
const LABELS = [
  "CB VERDANT PANTRY 0412 RIVERTON",
  "CB VERDANT PANTRY RIVERTON 1510",
  "PRLV SEPA VERDANT PANTRY ONLINE",
] as const;

const statement: Statement = {
  ...exampleStatement,
  lines: [
    { bookedOn: "2026-10-04", amountMinor: -2318, label: LABELS[0], reference: "VP2026100401" },
    { bookedOn: "2026-10-15", amountMinor: -4105, label: LABELS[1], reference: "VP2026101501" },
    { bookedOn: "2026-10-20", amountMinor: -999, label: LABELS[2], reference: "VP2026102001" },
  ],
};

/** The merchants a list or search page gives, by name. */
const namesOf = (text: string) =>
  [...text.matchAll(/^- (.+): \d+ cleaned labels?$/gm)].map(([, name]) => name ?? "");

/** The cleaned labels a merchant's page lists, in its second paragraph. */
function aliasesOf(text: string): Array<string> {
  const [, section = ""] = text.split("\n\n");

  return section
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

test("the same shop under several labels becomes one merchant, which an MCP client renames, splits and merges", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // One upload waiting for the app's import job, then the calls.
  test.setTimeout(90_000);

  const shopper = await addUser(app.baseURL, user, {
    name: "Sam Example",
    email: `sam.merchants.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-sam-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(shopper.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: statement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...shopper.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const merchants = (args: Arguments) => callText(session.client, "merchants", args);

  expect(session.client.getInstructions()).toContain("`merchants`");

  const file = writeStatement("camt053", statement);

  const uploaded = await callText(session.client, "imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);
  expect(uploaded.text).toContain(`Imported ${file.fileName} into ${ACCOUNT_NAME}`);
  expect(uploaded.text).toContain("3 lines read: 3 added");

  // The three labels make one merchant, recognised by the import.
  const found = await merchants({ action: "search", text: "verdant" });

  expect(found.isError, found.text).toBe(false);
  expect(found.text).toContain('1 merchant(s) whose name or a cleaned label contains "verdant".');

  const [recognised = ""] = namesOf(found.text);

  expect(recognised).toMatch(/verdant pantry/i);

  const shown = await merchants({ action: "show", merchant: recognised });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain(`Merchant: ${recognised}.`);

  const aliases = aliasesOf(shown.text);

  expect(aliases.length).toBeGreaterThanOrEqual(2);

  for (const alias of aliases) {
    expect(alias).toContain("VERDANT PANTRY");
  }

  for (const label of LABELS) {
    expect(shown.text).toContain(`, ${ACCOUNT_NAME}: `);
    expect(shown.text).toContain(`"${label}"`);
  }

  // Renamed.
  const renamed = await merchants({
    action: "edit",
    merchant: recognised,
    name: "Verdant Pantry Market",
  });

  expect(renamed.isError, renamed.text).toBe(false);
  expect(renamed.text).toContain('to "Verdant Pantry Market"');

  const afterRename = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterRename.text)).toEqual(["Verdant Pantry Market"]);

  // Split: the longest cleaned label moves to a merchant made for it.
  const moved = aliases.toSorted((a, b) => b.length - a.length)[0] ?? "";

  const split = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    alias: moved,
    to: "Verdant Pantry Online",
  });

  expect(split.isError, split.text).toBe(false);
  expect(split.text).toContain(
    `Moved the cleaned label "${moved}", and its lines, from Verdant Pantry Market to Verdant Pantry Online, a merchant made for it`,
  );

  const afterSplit = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterSplit.text)).toEqual(["Verdant Pantry Market", "Verdant Pantry Online"]);

  const online = await merchants({ action: "show", merchant: "Verdant Pantry Online" });

  expect(aliasesOf(online.text)).toEqual([moved]);

  const kept = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(aliasesOf(kept.text)).toEqual(aliases.filter((alias) => alias !== moved));

  // Merged back: one merchant again, with every cleaned label.
  const merged = await merchants({
    action: "merge",
    merchant: "Verdant Pantry Online",
    into: "Verdant Pantry Market",
  });

  expect(merged.isError, merged.text).toBe(false);
  expect(merged.text).toContain(
    "Merged Verdant Pantry Online into Verdant Pantry Market: 1 cleaned label moved, and Verdant Pantry Online deleted.",
  );

  const afterMerge = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterMerge.text)).toEqual(["Verdant Pantry Market"]);

  const whole = await merchants({ action: "show", merchant: "verdant pantry market" });

  expect(aliasesOf(whole.text)).toEqual(aliases);

  // A merge into itself is refused with a call that answers.
  const itself = await merchants({
    action: "merge",
    merchant: "Verdant Pantry Market",
    into: "verdant pantry market",
  });

  expect(itself.isError).toBe(true);
  expect(itself.text).toContain("never into itself");
  expect(itself.text).toContain('A valid call: merchants {"action":"search"');

  // Its default category (#23): a category of the user's own, set, shown, kept archived, cleared.
  const created = await callText(session.client, "categories", {
    action: "create",
    name: "Pantry runs",
  });

  expect(created.isError, created.text).toBe(false);

  const set = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    category: "pantry runs",
  });

  expect(set.isError, set.text).toBe(false);
  expect(set.text).toBe(
    "Verdant Pantry Market's default category is now Pantry runs (expense): the category its entries go in by default.",
  );

  const withDefault = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(withDefault.text).toContain("Default category: Pantry runs (expense).");

  const unknown = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    category: "Pantry trips",
  });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('No category of the user\'s is named "Pantry trips".');

  const archived = await callText(session.client, "categories", {
    action: "archive",
    category: "Pantry runs",
  });

  expect(archived.isError, archived.text).toBe(false);

  const keptArchived = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(keptArchived.text).toContain("Default category: Pantry runs (expense), archived");

  const cleared = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    category: "none",
  });

  expect(cleared.text).toBe("Verdant Pantry Market has no default category any more.");
});
