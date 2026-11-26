import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";

import { importsOn, statementFile } from "../src/imports";
import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #208 through the MCP door, with a real client and the real OAuth flow, against the built
// app and a real Postgres: a line coming back that may be a refund, not answered yet, is no income.
// `month` `summary` leaves it out of received and says how much waits apart, `lines` `search`, `show`
// and `review` `list` flag it; confirmed with `lines` `link`, the purchase costs less; refused with
// `lines` `refuse_refund`, it is an ordinary income, never proposed again. Each test's user is its
// own, their statement imported as the import job runs it: a 90.00 purchase at PixelPlay on the 3rd
// of last month, 30.00 coming back from it on the 4th. Every name and amount is invented.
//
// The MCP door reads today from the server's clock: the lines are booked last month, so that they
// read the same whenever the test runs.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** The month `offset` months from the current one, `YYYY-MM`, as the server's clock reads it. */
function monthFromNow(offset: number): string {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

const LAST_MONTH = monthFromNow(-1);
const PURCHASE_DAY = `${LAST_MONTH}-03`;
const BACK_DAY = `${LAST_MONTH}-04`;
const LABEL = "CARD PIXELPLAY STORE";

/** How a line that may be a refund, not answered yet, is flagged wherever it is listed. */
const FLAG = "maybe a refund, not counted as income until the user answers";

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: string };

/** The text of the tool's answer, and whether it is an error. */
async function callTool(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** The handles a search result gives, in order (newest first). */
const handlesOf = (text: string) =>
  [...text.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id ?? "");

/** The line of a result that names `lineId`'s handle. */
const rowOf = (text: string, lineId: string) =>
  text.split("\n").find((each) => each.includes(`line: ${lineId}`)) ?? "";

/** The call a result writes after `before` (`lines {…}`), as it is written. */
const writtenCall = (text: string, before: string) =>
  text
    .split("\n")
    .find((each) => each.startsWith(before))
    ?.slice(before.length) ?? "";

/** A new user of the test's own, their purchase and its 30.00 back imported; their client. */
async function pixelPlayUser(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  mcpClientId: string,
  local: string,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);
  const accountId = await imports.createAccount(owner, "Everyday account");

  const lines: ReadonlyArray<Omit<StatementLine, "reference">> = [
    { bookedOn: PURCHASE_DAY, amountMinor: -9000, label: LABEL },
    { bookedOn: BACK_DAY, amountMinor: 3000, label: LABEL },
  ];

  const statement: Statement = {
    ...exampleStatement,
    from: `${LAST_MONTH}-01`,
    to: `${LAST_MONTH}-28`,
    lines: lines.map((line, index) => ({ ...line, reference: `${local}-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    accountId,
    statementFile("ofx", statement, `${local}.ofx`),
  );

  expect(done.status).toBe("done");

  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const found = await callTool(client, "lines", { action: "search", text: "pixelplay" });
  const [back = "", purchase = ""] = handlesOf(found.text);

  expect([back, purchase].every(Boolean), found.text).toBe(true);

  return { client, back, purchase, found };
}

test("before confirmation, the month's received excludes the likely refund and shows it apart", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client, back, purchase, found } = await pixelPlayUser(
    page,
    app,
    user,
    mcpClientId,
    "xavier",
  );

  const summary = await callTool(client, "month", { action: "summary", month: LAST_MONTH });

  expect(summary.isError, summary.text).toBe(false);
  expect(summary.text).toContain("Received 0.00 EUR.");
  expect(summary.text).toContain(
    "Not in received: 1 line(s) coming back that may be refunds, 30.00 EUR in all, waiting for the user's answer",
  );
  expect(summary.text).toContain("Spent 90.00 EUR");
  expect(summary.text).toContain(`- ${BACK_DAY}, ${FLAG}: `);
  expect(summary.text).toContain(`30.00 EUR; lines {"action":"show","line":"${back}"}`);
  expect(summary.text).not.toContain(", income: ");

  // The search flags the line coming back, not the purchase.
  expect(rowOf(found.text, back)).toContain(`30.00 EUR, "${LABEL}"`);
  expect(rowOf(found.text, back)).toContain(FLAG);
  expect(rowOf(found.text, purchase)).toContain(`-90.00 EUR, "${LABEL}"`);
  expect(rowOf(found.text, purchase)).not.toContain("maybe a refund");

  // Its detail says it is no income until answered, and writes both answers.
  const shown = await callTool(client, "lines", { action: "show", line: back });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain("Maybe a refund: this line may cancel all or part of an expense");
  expect(shown.text).toContain("Not counted as income until the user answers");
  expect(shown.text).toContain(`line: ${purchase}, in Other, costing 90.00 EUR`);
  expect(writtenCall(shown.text, "Confirm one with: ")).toBe(
    `lines {"action":"link","line":"${back}","into":"${purchase}"}`,
  );
  expect(writtenCall(shown.text, "If it is no refund: ")).toBe(
    `lines {"action":"refuse_refund","line":"${back}"}`,
  );

  // The lines to review flag it the same way.
  const listed = await callTool(client, "review", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(rowOf(listed.text, back)).toContain(`(${FLAG})`);
  expect(listed.text).toContain(`lines {"action":"refuse_refund","line":"${back}"}`);

  // Not in "Other" as income either: the categories' monthly averages leave it out.
  const categories = await callTool(client, "categories", { action: "list" });

  expect(categories.isError, categories.text).toBe(false);
  expect(categories.text).toContain("average 90.00 EUR a month");
  expect(categories.text).not.toContain("30.00 EUR a month");
});

test("after confirmation, the purchase's net cost drops to 60.00", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client, back, purchase } = await pixelPlayUser(page, app, user, mcpClientId, "yvonne");

  const confirmed = await callTool(client, "lines", { action: "link", line: back, into: purchase });

  expect(confirmed.isError, confirmed.text).toBe(false);
  expect(confirmed.text).toContain("Linked as a refund.");
  expect(confirmed.text).toContain("counted once at its net cost of 60.00 EUR");

  const summary = await callTool(client, "month", { action: "summary", month: LAST_MONTH });

  expect(summary.isError, summary.text).toBe(false);
  expect(summary.text).toContain("Received 0.00 EUR.");
  expect(summary.text).toContain("Spent 60.00 EUR");
  expect(summary.text).not.toContain("may be refunds");
  expect(summary.text).not.toContain(FLAG);

  const shown = await callTool(client, "lines", { action: "show", line: back });

  expect(shown.text).toContain("This line is one of its refunds.");
  expect(shown.text).not.toContain("Maybe a refund");

  const found = await callTool(client, "lines", { action: "search", text: "pixelplay" });

  expect(found.text).not.toContain("maybe a refund");
});

test("after refusal, it is an income: received includes it and nothing is proposed any more", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client, back } = await pixelPlayUser(page, app, user, mcpClientId, "zelie");

  const refused = await callTool(client, "lines", { action: "refuse_refund", line: back });

  expect(refused.isError, refused.text).toBe(false);
  expect(refused.text).toContain(
    `No refund: the line of ${BACK_DAY}, 30.00 EUR, "${LABEL}", is an ordinary income now, in Other: counted as received in its month. It will not be proposed as a refund again.`,
  );

  const summary = await callTool(client, "month", { action: "summary", month: LAST_MONTH });

  expect(summary.isError, summary.text).toBe(false);
  expect(summary.text).toContain("Received 30.00 EUR");
  expect(summary.text).toContain("Spent 90.00 EUR");
  expect(summary.text).toContain(`- ${BACK_DAY}, income: `);
  expect(summary.text).not.toContain("may be refunds");
  expect(summary.text).not.toContain(FLAG);

  // An income in "Other" now: its category's monthly average counts it.
  const categories = await callTool(client, "categories", { action: "list" });

  expect(categories.text).toContain("average 30.00 EUR a month");

  // Nothing is proposed any more, wherever the line is read.
  const shown = await callTool(client, "lines", { action: "show", line: back });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).not.toContain("Maybe a refund");
  expect(shown.text).not.toContain("refuse_refund");

  const found = await callTool(client, "lines", { action: "search", text: "pixelplay" });

  expect(found.text).not.toContain("maybe a refund");

  const listed = await callTool(client, "review", { action: "list" });

  expect(listed.text).not.toContain("maybe a refund");
  expect(listed.text).not.toContain("refuse_refund");

  // Answering again changes nothing.
  const again = await callTool(client, "lines", { action: "refuse_refund", line: back });

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain("is an ordinary income now");
});

test("a token allowed to read only cannot refuse a refund", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: (page) => page.getByRole("button", { name: "Allow read only" }).click(),
    scope: "read write",
    clientId: mcpClientId,
  });

  const refused = await callTool(session.client, "lines", { action: "refuse_refund", line: "any" });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("choose Read and write on Gousset's consent page");
});
