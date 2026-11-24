import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { Today, pairLines, transfersLayer } from "@gousset/core";
import type { Transfers } from "@gousset/core";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";
import { and, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #29 through the MCP door, with a real client and the real OAuth flow: `lines` `show` of a
// works council refund's side offers the expenses it may fund, with the call that funds one; `link`
// funds it; `show` of either side gives the link; a funding past the expense's cost is refused with
// a valid call; `unlink` unfunds. The user is the test's own. The bank's lines are imported as the
// import job runs them, the works council account's entered by hand and paired by hand. Every
// name, label and amount is invented: PerksHub refunds 80 of a sports club's 120.

const TODAY = "2026-11-30";

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

const runTransfers = <A, E>(effect: Effect.Effect<A, E, Transfers>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(transfersLayer.pipe(Layer.provide(data.layer))),
      Effect.provideService(Today, { day: Effect.succeed(TODAY) }),
    ),
  );

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of the tool's answer, and whether it is an error. */
async function callLines(client: Client, args: { readonly [key: string]: string }) {
  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** The handles a search result gives, in order (newest first). */
const handlesOf = (text: string) =>
  [...text.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id ?? "");

const Written = Schema.Record(Schema.String, Schema.String);

/** The arguments of the call a result writes after `before` (`lines {…}`), read back. */
function writtenCall(text: string, before: string) {
  const at = text.indexOf(`${before}lines {`);

  expect(at, text).toBeGreaterThan(-1);

  const json = text.slice(at + before.length + "lines ".length).split("\n")[0] ?? "";

  return Schema.decodeUnknownSync(Written)(JSON.parse(json));
}

async function newAccount(owner: string, name: string, kind: "current" | "benefit") {
  const [created] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(account)
      .values({ userId: owner, name, kind, institution: "PerksHub", currency: "EUR" })
      .returning({ id: account.id }),
  );

  if (created === undefined) {
    throw new Error("The account was not created.");
  }

  return created.id;
}

test("an MCP client funds an expense with a works council refund, reads both sides and unfunds it", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const person = await addUser(app.baseURL, user, personOfItsOwn("eli.works-council-mcp"));
  const owner = await data.ownerOf(person.email);
  const bank = await newAccount(owner, "Everyday account", "current");
  const perksHub = await newAccount(owner, "PerksHub", "benefit");

  const statement: Statement = {
    ...exampleStatement,
    lines: [
      { bookedOn: "2026-10-02", amountMinor: -12_000, label: "CB RIVERSIDE SPORTS CLUB 0210" },
      { bookedOn: "2026-10-05", amountMinor: -2000, label: "CB CORNER CAFE 0510" },
      { bookedOn: "2026-10-20", amountMinor: 8000, label: "VIR PERKSHUB REMBOURSEMENT" },
    ].map((line, index) => ({ ...line, reference: `works-council-mcp-${index + 1}` })),
  };

  const done = await imports.importFile(
    owner,
    bank,
    statementFile("ofx", statement, "works-council-mcp.ofx"),
  );

  expect(done.status).toBe("done");

  // The works council account's side, entered by hand, paired by hand with the bank's.
  const [out] = await data.asUser(owner, (transaction) =>
    transaction
      .insert(statementLine)
      .values({
        userId: owner,
        accountId: perksHub,
        source: "manual",
        bookedOn: "2026-10-19",
        amountMinor: -8000,
        label: "PERKSHUB REFUND 0042",
      })
      .returning({ id: statementLine.id }),
  );

  const [into] = await data.asUser(owner, (transaction) =>
    transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(and(eq(statementLine.accountId, bank), eq(statementLine.amountMinor, 8000))),
  );

  if (out === undefined || into === undefined) {
    throw new Error("The refund's sides were not made.");
  }

  await runTransfers(pairLines(owner, out.id, into.id));
  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  /** The handle of the one line a piece of its label finds. */
  const handleOf = async (text: string) =>
    handlesOf((await callLines(client, { action: "search", text })).text)[0];

  const side = await handleOf("perkshub refund");
  const sportsClub = await handleOf("sports club");
  const coffee = await handleOf("corner cafe");

  expect([side, sportsClub, coffee].every(Boolean)).toBe(true);

  // The side offers what it may fund, never funded unasked, with the call that funds it.
  const offered = await callLines(client, { action: "show", line: side ?? "" });

  expect(offered.isError, offered.text).toBe(false);
  expect(offered.text).toContain(
    "A works council refund (a transfer from a benefit account): it may fund one of these expenses, which keeps its cost.",
  );
  expect(offered.text).toContain("costing 120.00 EUR");
  expect(offered.text).not.toContain("CB CORNER CAFE");

  const fundCall = writtenCall(offered.text, "Fund one with: ");

  expect(fundCall).toEqual({ action: "link", line: side, into: sportsClub });

  // A coffee of 20 cannot take a refund of 80: refused, with a call that answers.
  const refused = await callLines(client, {
    action: "link",
    line: side ?? "",
    into: coffee ?? "",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text.length).toBeLessThan(2000);
  expect(refused.text).toContain("would fund more than the expense");

  const example = writtenCall(refused.text, "A valid call: ");
  const answered = await callLines(client, example);

  expect(answered.isError, answered.text).toBe(false);

  // Funded: the expense keeps its cost.
  const funded = await callLines(client, fundCall);

  expect(funded.isError, funded.text).toBe(false);
  expect(funded.text).toContain("which keeps its cost of 120.00 EUR");
  expect(funded.text).toContain(
    "Funded by transfers from a benefit account (works council refunds), 80.00 EUR in all; it still costs 120.00 EUR:",
  );

  // Both sides show the link: the expense its funding, the refund what it funds.
  const expense = await callLines(client, { action: "show", line: sportsClub ?? "" });

  expect(expense.text).toContain("80.00 EUR in all; it still costs 120.00 EUR");
  expect(expense.text).toContain(
    `from PerksHub (PerksHub), "PERKSHUB REFUND 0042"; line: ${side ?? ""}`,
  );

  const refund = await callLines(client, { action: "show", line: side ?? "" });

  expect(refund.text).toContain("A works council refund: it funds the expense of 2026-10-02");
  expect(writtenCall(refund.text, "To unfund it: ")).toEqual({ action: "unlink", line: side });

  // Unfunded: the transfer stays, the expense is funded by nothing.
  const unfunded = await callLines(client, { action: "unlink", line: side ?? "" });

  expect(unfunded.isError, unfunded.text).toBe(false);
  expect(unfunded.text).toContain("Unfunded: the line stays a side of its transfer");

  const after = await callLines(client, { action: "show", line: sportsClub ?? "" });

  expect(after.text).not.toContain("Funded by");

  const again = await callLines(client, { action: "unlink", line: side ?? "" });

  expect(again.isError).toBe(true);
  expect(again.text).toContain("and funds none");
});
