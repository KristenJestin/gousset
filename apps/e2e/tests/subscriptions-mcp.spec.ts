import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";
import type { Schema } from "effect";

import { addUser, connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #34 through the MCP door: `month` `subscriptions` gives the recurring payments detected from
// an imported statement, the one that stopped and the price that rose; `merchants` `edit` with
// `subscription` false says one is no subscription, true brings it back; a token allowed to read
// only reads them and cannot dismiss. The official MCP client over the real OAuth flow, against the
// built app, its import job and a real Postgres. Every merchant, amount and label is invented.
//
// The MCP door reads today from the server's clock (a client sends no cookie): the statement is
// written in the months before the current one, so that it reads the same whenever it runs.

const ACCOUNT_NAME = "Everyday account";

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: Schema.Json };

/** The month `offset` months from the current one, `YYYY-MM`, as the server's clock reads it. */
function monthFromNow(offset: number): string {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

const line = (month: string, day: string, amountMinor: number, label: string) => ({
  bookedOn: `${month}-${day}`,
  amountMinor,
  label,
  reference: `${label.replaceAll(" ", "").slice(-8)}${month.replace("-", "")}${day}`,
});

const LAST_MONTH = monthFromNow(-1);
const TWO_MONTHS_AGO = monthFromNow(-2);

/**
 * A monthly streaming plan whose price rose last month, a gym whose payment of last month did not
 * come, and a phone bill that varies, which is no subscription.
 */
const LINES: ReadonlyArray<StatementLine> = [
  ...[-5, -4, -3, -2].map((offset) => line(monthFromNow(offset), "08", -949, "PRLV SEPA STREAMLY")),
  line(LAST_MONTH, "08", -1099, "PRLV SEPA STREAMLY"),
  ...[-5, -4, -3, -2].map((offset) => line(monthFromNow(offset), "03", -2900, "PRLV SEPA FITCLUB")),
  line(monthFromNow(-4), "28", -1600, "PRLV SEPA WAVELY MOBILE"),
  line(monthFromNow(-3), "28", -2340, "PRLV SEPA WAVELY MOBILE"),
  line(TWO_MONTHS_AGO, "28", -1875, "PRLV SEPA WAVELY MOBILE"),
];

test("an MCP client reads the month's subscriptions, dismisses one and brings it back", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const person = await addUser(app.baseURL, user, {
    name: "Wren Example",
    email: `wren.subscriptions.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-wren-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: exampleStatement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = async (name: string, args: Arguments) => {
    const result = await session.client.callTool({ name, arguments: args });
    const [answer] = result.content ?? [];

    return { text: answer?.type === "text" ? answer.text : "", isError: result.isError === true };
  };

  const file = writeStatement("camt053", {
    ...exampleStatement,
    from: `${monthFromNow(-5)}-01`,
    to: `${LAST_MONTH}-28`,
    lines: LINES,
  });

  const uploaded = await call("imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);
  expect(uploaded.text).toContain(`${LINES.length} lines read: ${LINES.length} added`);

  const read = await call("month", { action: "subscriptions", month: LAST_MONTH });

  expect(read.isError, read.text).toBe(false);
  expect(read.text).toContain(`Subscriptions of ${LAST_MONTH}`);
  expect(read.text).toContain(
    `- Streamly: monthly, usually 9.49 EUR; last paid ${LAST_MONTH}-08, 10.99 EUR; next expected ${monthFromNow(0)}-08.`,
  );
  expect(read.text).toContain(
    `- Fitclub: monthly, expected ${LAST_MONTH}-03, did not come; last paid ${TWO_MONTHS_AGO}-03, 29.00 EUR.`,
  );
  expect(read.text).toContain("Price rises (1):\n- Streamly: from 9.49 EUR to 10.99 EUR.");
  // A bill that varies is no subscription.
  expect(read.text).not.toContain("Wavely");

  const dismissed = await call("merchants", {
    action: "edit",
    merchant: "Streamly",
    subscription: false,
  });

  expect(dismissed.isError, dismissed.text).toBe(false);
  expect(dismissed.text).toContain("Streamly's payments are no subscription");

  const without = await call("month", { action: "subscriptions", month: LAST_MONTH });

  expect(without.text).not.toContain("Streamly");
  expect(without.text).toContain("- Fitclub: monthly");
  expect((await call("merchants", { action: "show", merchant: "Streamly" })).text).toContain(
    "The user said its payments are no subscription",
  );

  const back = await call("merchants", {
    action: "edit",
    merchant: "Streamly",
    subscription: true,
  });

  expect(back.isError, back.text).toBe(false);
  expect((await call("month", { action: "subscriptions", month: LAST_MONTH })).text).toContain(
    "- Streamly: monthly, usually 9.49 EUR",
  );

  const toCome = await call("month", { action: "subscriptions", month: monthFromNow(1) });

  expect(toCome.isError).toBe(true);
  expect(toCome.text).toContain("is a month to come");
});

test("a token allowed to read only reads the subscriptions and cannot dismiss one", async ({
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

  const read = await session.client.callTool({
    name: "month",
    arguments: { action: "subscriptions" },
  });

  expect(read.isError).not.toBe(true);

  const refused = await session.client.callTool({
    name: "merchants",
    arguments: { action: "edit", merchant: "Streamly", subscription: false },
  });

  const [answer] = refused.content ?? [];

  expect(refused.isError).toBe(true);
  expect(answer?.type === "text" ? answer.text : "").toContain(
    "choose Read and write on Gousset's consent page",
  );
});
