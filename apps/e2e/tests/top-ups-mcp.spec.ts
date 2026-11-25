import type { Page } from "@playwright/test";
import { account, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import type { Client } from "@modelcontextprotocol/client";
import { asc, eq, inArray } from "drizzle-orm";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #28's MCP scenario: a benefit card's top-up settings set through `accounts edit`, through
// the official MCP client and the real OAuth flow, on accounts of a user of this file's own. The
// daily cap given there makes the card's purchase and the bank line its issuer charged the rest to
// one expense, at once. Every issuer, amount and label is invented.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;
let owner = "";
let person: Awaited<ReturnType<typeof addUser>>;

test.beforeAll(async ({ app, user }) => {
  person = await addUser(app.baseURL, user, {
    name: "Mae Example",
    email: `mae.top-ups.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-mae-password-${app.slot}`,
  });

  data = openUserData(app.database);
  imports = importsOn(data);
  owner = await data.ownerOf(person.email);
});

test.afterAll(async () => {
  await data.close();
});

async function newAccount(name: string, kind: "current" | "benefit", institution: string) {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, institution, currency: "EUR" })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

async function importInto(
  accountId: string,
  name: string,
  lines: ReadonlyArray<Omit<StatementLine, "reference">>,
) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${name}.ofx`),
  );

  expect(done.status, name).toBe("done");
}

const linesOf = (accountId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(eq(statementLine.accountId, accountId))
      .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
  );

/** How many expenses the lines are part of. */
const expensesOf = async (lineIds: ReadonlyArray<string>) =>
  new Set(
    (
      await data.asUser(owner, (transaction) =>
        transaction
          .select({ entryId: entryPart.entryId })
          .from(entryPart)
          .where(inArray(entryPart.lineId, [...lineIds])),
      )
    ).map((part) => part.entryId),
  ).size;

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

async function callTool(
  client: Client,
  name: string,
  args: { readonly [key: string]: string | number },
) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

test("a daily cap set through accounts edit matches the top-up within the issuer's delay", async ({
  page,
  baseURL,
  mcpClientId,
}) => {
  const card = await newAccount("Plateful card", "benefit", "Plateful");
  const current = await newAccount("Plateful current", "current", "Riverside Bank");

  await importInto(card, "plateful-card", [
    { bookedOn: "2026-10-01", amountMinor: 20_000, label: "PLATEFUL CREDIT" },
    { bookedOn: "2026-10-10", amountMinor: -2500, label: "CB GREENMARKET RIVERTON" },
  ]);

  await importInto(current, "plateful-current", [
    { bookedOn: "2026-10-11", amountMinor: -730, label: "CB PLATEFUL*TOPUP" },
  ]);

  const purchase = (await linesOf(card)).find((line) => line.amountMinor === -2500)?.id ?? "";
  const rest = (await linesOf(current))[0]?.id ?? "";

  // Money left on the card and no cap known: nothing to match yet.
  expect(await expensesOf([purchase, rest])).toBe(2);

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const edited = await callTool(client, "accounts", {
    action: "edit",
    name: "Plateful card",
    top_up_days: 2,
    top_up_cap: "25.00",
  });

  expect(edited.isError, edited.text).toBe(false);
  expect(edited.text).toContain("within 2 days joins the purchase; a daily cap of 25.00 EUR.");

  // The purchase reached the cap: the bank line a day later is its rest, one expense.
  expect(await expensesOf([purchase, rest])).toBe(1);

  const refused = await callTool(client, "accounts", {
    action: "edit",
    name: "Plateful card",
    top_up_cap: "0",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("A daily cap is more than nothing.");
});
