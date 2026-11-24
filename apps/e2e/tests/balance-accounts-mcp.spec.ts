import type { Page } from "@playwright/test";
import {
  DatabaseAccountStore,
  DatabaseCategoryStore,
  createAccount,
  createCategory,
  editAccount,
} from "@gousset/core";
import type { AccountStore, CategoryStore } from "@gousset/core";
import type { AccountInput } from "@gousset/core/account-values";
import { statementLine } from "@gousset/db/schema/ledger";
import type { Client } from "@modelcontextprotocol/client";
import { Effect, Layer } from "effect";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #31's MCP scenarios: an account kept by its balance, its balance noted through
// `accounts note_balance` and a line paired with it through `lines pair` with `account`, through
// the official MCP client and the real OAuth flow, on accounts of a user of this file's own. Each
// test makes accounts and a category with names of their own. Every amount and name is invented.

let data: ReturnType<typeof openUserData>;
let owner = "";
let person: Awaited<ReturnType<typeof addUser>>;

test.beforeAll(async ({ app, user }) => {
  person = await addUser(app.baseURL, user, {
    name: "Lou Example",
    email: `lou.balance.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-lou-password-${app.slot}`,
  });

  data = openUserData(app.database);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

/** Runs the accounts' and the categories' logic on the worker's database. */
const run = <A, E>(effect: Effect.Effect<A, E, AccountStore | CategoryStore>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(DatabaseAccountStore, DatabaseCategoryStore).pipe(Layer.provide(data.layer)),
      ),
    ),
  );

/** A name no other test gives. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 6)}`;

/** A new account of the user's, in euros, opened with nothing on it. */
async function newAccount(name: string, choice: "current" | "benefit", mode: "lines" | "balance") {
  const settings: AccountInput = {
    name,
    choice,
    institution: "Riverside Bank",
    currency: "EUR",
    mode,
    openingBalanceMinor: 0,
  };

  const created = await run(createAccount(owner, settings));

  return { id: created.id, settings };
}

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callTool(client: Client, name: string, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

test("a balance going from 120 to 80 with a transfer of 50 in gives an expense of 90", async ({
  page,
  baseURL,
  mcpClientId,
}) => {
  const category = await run(createCategory(owner, { kind: "expense", name: unique("Meals") }));
  const current = await newAccount(unique("Balance current"), "current", "lines");
  const card = await newAccount(unique("Meal card"), "benefit", "balance");
  const cardName = card.settings.name;

  // Its category, as the account's settings set it: no tool edits them.
  await run(editAccount(owner, card.id, { ...card.settings, balanceCategoryId: category.id }));

  await data.asUser(owner, (transaction) =>
    transaction.insert(statementLine).values({
      userId: owner,
      accountId: current.id,
      source: "manual",
      bookedOn: "2026-10-12",
      amountMinor: -5000,
      label: "SEPA TRF TO MEAL CARD",
    }),
  );

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  // The first balance: from the opening balance of nothing, 120 came in.
  const september = await callTool(client, "accounts", {
    action: "note_balance",
    name: cardName,
    day: "2026-09-30",
    balance: "120.00",
  });

  expect(september.isError, september.text).toBe(false);
  expect(september.text).toContain(
    `Noted: ${cardName} (Riverside Bank) held 120.00 EUR at the end of 2026-09-30.`,
  );
  expect(september.text).toContain(
    "Its movement, the line Gousset made of it: 120.00 EUR, an income",
  );

  // The 50 that left the current account went into the meal card.
  const found = await callTool(client, "lines", {
    action: "search",
    text: "trf to meal card",
    account: current.settings.name,
  });

  const line = /; line: (\S+)$/m.exec(found.text)?.[1] ?? "";

  expect(line, found.text).not.toBe("");

  const paired = await callTool(client, "lines", { action: "pair", line, account: cardName });

  expect(paired.isError, paired.text).toBe(false);
  expect(paired.text).toContain(
    `Transfer to ${cardName} (Riverside Bank), paired by the user: never counted as spending.`,
  );

  // 120, then 50 in, then 80 left: 90 was spent.
  const october = await callTool(client, "accounts", {
    action: "note_balance",
    name: cardName,
    day: "2026-10-31",
    balance: "80.00",
  });

  expect(october.isError, october.text).toBe(false);
  expect(october.text).toContain(
    `Its movement, the line Gousset made of it: -90.00 EUR, an expense in ${category.name}.`,
  );

  const shown = await callTool(client, "accounts", { action: "show", name: cardName });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain(`One that is an expense goes to ${category.name};`);
  expect(shown.text).toContain("- 2026-10-31: -90.00 EUR, movement of the noted balance");
  expect(shown.text).toContain("- 2026-10-12: 50.00 EUR, ");

  const movement = await callTool(client, "lines", {
    action: "search",
    account: cardName,
    from: "2026-10-31",
    to: "2026-10-31",
  });

  expect(movement.text).toContain(
    `- 2026-10-31, ${cardName} (Riverside Bank): -90.00 EUR, (movement of the noted balance), in ${category.name}; line: `,
  );
});

test("a token that reads only is refused a noted balance, and told how to allow writes", async ({
  page,
  baseURL,
  mcpClientId,
}) => {
  const card = await newAccount(unique("Gift card"), "benefit", "balance");

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const refused = await callTool(client, "accounts", {
    action: "note_balance",
    name: card.settings.name,
    day: "2026-10-31",
    balance: "80.00",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("this connection was allowed to read only");
  expect(refused.text).toContain("choose Read and write on Gousset's consent page");

  // Nothing was noted: the account still has no line.
  const shown = await callTool(client, "accounts", { action: "show", name: card.settings.name });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain("No line yet.");
});
