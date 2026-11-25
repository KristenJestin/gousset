import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";
import { Schema } from "effect";

import type { WorkerEnvironment } from "../src/app-server";
import type { TestUser } from "../src/auth";
import { addUser, connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #30 through the MCP door: a line paid through a payment intermediary asks who was paid,
// `merchants` `assign` sets it, and the rule it proposes sets it on the next such lines; with
// `imports`, `lines` and `rules`, called by the official MCP client over the real OAuth flow,
// against the built app, its import job and a real Postgres. Each test has a user of its own. Every
// line, shop and intermediary here is invented but PayPal's name, which Gousset knows.

const ACCOUNT_NAME = "Everyday account";

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: Schema.Json };

const Written = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/** What a test needs to make a user of its own and connect their MCP client. */
type Setup = {
  readonly app: WorkerEnvironment;
  readonly user: TestUser;
  readonly page: Page;
  readonly mcpClientId: string;
  readonly repeat: number;
};

/**
 * A user of the test's own, with one current account the example statement's IBAN names, and their
 * MCP client allowed to read and write; the calls a test makes through it.
 */
async function intermediariesUser(setup: Setup, first: string) {
  const slug = first.toLowerCase();

  const person = await addUser(setup.app.baseURL, setup.user, {
    name: `${first} Example`,
    email: `${slug}.intermediaries.worker${setup.app.slot}.${setup.repeat}@example.com`,
    password: `e2e-${slug}-password-${setup.app.slot}`,
  });

  const data = openUserData(setup.app.database);

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

  await setup.page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: setup.app.baseURL,
    page: setup.page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: setup.mcpClientId,
  });

  /** The text of a tool's answer, and whether it is an error. */
  const call = async (name: string, args: Arguments) => {
    const result = await session.client.callTool({ name, arguments: args });
    const [answer] = result.content ?? [];

    return { text: answer?.type === "text" ? answer.text : "", isError: result.isError === true };
  };

  /** Imports `lines` through `imports`, as an MCP client uploads a statement. */
  const upload = async (lines: ReadonlyArray<StatementLine>) => {
    const file = writeStatement("camt053", { ...exampleStatement, lines });

    const uploaded = await call("imports", {
      action: "upload",
      file_name: file.fileName,
      content: file.contents,
    });

    expect(uploaded.isError, uploaded.text).toBe(false);
    expect(uploaded.text).toContain(`${lines.length} lines read: ${lines.length} added`);
  };

  /** The line of that label, as `lines` `show` gives it, with its handle. */
  const show = async (label: string) => {
    const found = await call("lines", { action: "search", limit: 100 });

    expect(found.isError, found.text).toBe(false);

    const row = found.text.split("\n").find((each) => each.includes(`"${label}"`)) ?? "";
    const handle = /; line: (\S+)$/.exec(row)?.[1] ?? "";

    expect(handle, label).not.toBe("");

    const shown = await call("lines", { action: "show", line: handle });

    expect(shown.isError, shown.text).toBe(false);

    return { handle, text: shown.text };
  };

  return { call, upload, show };
}

/** The call a text writes after `lead`, read back. */
function callAfter(text: string, lead: string): Arguments {
  const at = text.indexOf(lead);

  expect(at, text).toBeGreaterThan(-1);

  return Schema.decodeUnknownSync(Written)(text.slice(at + lead.length).split("\n")[0] ?? "");
}

const line = (bookedOn: string, amountMinor: number, label: string, reference: string) => ({
  bookedOn,
  amountMinor,
  label,
  reference,
});

const ASKS = "who was paid is not set";

test("an intermediary's line asks for its merchant", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Quinn",
  );

  const label = "CB PAYPAL *PIXELPLAY 21/10";

  await upload([line("2026-10-21", -1999, label, "PP2110")]);

  // Recognition made the intermediary's merchant from its label, marked as one.
  const found = await call("merchants", { action: "search", text: "paypal" });

  expect(found.text).toContain("- Paypal (payment intermediary): 1 cleaned label");

  const asked = await show(label);

  expect(asked.text).toContain(`Paid through Paypal, a payment intermediary: ${ASKS}.`);

  const assign = callAfter(asked.text, "Ask the user, then: merchants ");

  expect(assign).toEqual({ action: "assign", line: asked.handle, merchant: "<who was paid>" });

  const assigned = await call("merchants", { ...assign, merchant: "Pixelplay" });

  expect(assigned.isError, assigned.text).toBe(false);
  expect(assigned.text).toContain("is now Pixelplay, a merchant made for it.");

  const answered = await show(label);

  expect(answered.text).toContain("Merchant: Pixelplay, paid through Paypal.");
  expect(answered.text).not.toContain(ASKS);

  // An intermediary is never who was paid.
  const refused = await call("merchants", { ...assign, merchant: "paypal" });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("is a payment intermediary itself");
});

test("the rule assigns it next time", async ({ app, user, page, mcpClientId }, testInfo) => {
  // Two uploads waiting for the app's import job, then the calls.
  test.setTimeout(150_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Rowan",
  );

  const first = "CB PAYPAL *PIXELPLAY 21/10";
  const later = "CB PAYPAL *PIXELPLAY 04/11";
  const elsewhere = "CB PAYPAL *BRIGHTREAD 06/11";

  await upload([line("2026-10-21", -1999, first, "PP2110")]);

  const assigned = await call("merchants", {
    action: "assign",
    line: (await show(first)).handle,
    merchant: "Pixelplay",
  });

  expect(assigned.isError, assigned.text).toBe(false);

  // The proposed rule looks for who was paid behind the intermediary, never the intermediary alone.
  const proposed = callAfter(assigned.text, "propose this rule to the user: rules ");

  expect(proposed).toEqual({
    action: "create",
    conditions: [{ field: "label", operator: "contains", value: "PAYPAL *PIXELPLAY" }],
    merchant: "Pixelplay",
    from_correction: true,
  });

  const created = await call("rules", proposed);

  expect(created.isError, created.text).toBe(false);
  expect(created.text).toContain("Created this rule");

  // A second statement: its Pixelplay line gets its merchant by the rule; another shop paid through
  // the same intermediary still asks.
  await upload([
    line("2026-11-04", -1499, later, "PP0411"),
    line("2026-11-06", -899, elsewhere, "PP0611"),
  ]);

  const ruled = await show(later);

  expect(ruled.text).toContain("Merchant: Pixelplay, paid through Paypal.");
  expect(ruled.text).not.toContain(ASKS);

  expect((await show(elsewhere)).text).toContain(
    `Paid through Paypal, a payment intermediary: ${ASKS}.`,
  );
});

test("a merchant the user marks is an intermediary", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Sage",
  );

  const label = "CB PAYLINK *CORNER BAKERY 03/11";

  await upload([line("2026-11-03", -640, label, "PL0311")]);

  // Gousset does not know this intermediary: the line is its label's merchant's, and asks nothing.
  const before = await show(label);

  expect(before.text).toContain("Merchant: Paylink.");
  expect(before.text).not.toContain(ASKS);

  const refused = await call("merchants", {
    action: "assign",
    line: before.handle,
    merchant: "Corner Bakery",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("names no payment intermediary");

  const marked = await call("merchants", {
    action: "edit",
    merchant: "Paylink",
    intermediary: true,
  });

  expect(marked.isError, marked.text).toBe(false);
  expect(marked.text).toContain("Paylink is now a payment intermediary");

  const asked = await show(label);

  expect(asked.text).toContain(`Paid through Paylink, a payment intermediary: ${ASKS}.`);

  const assigned = await call("merchants", {
    action: "assign",
    line: asked.handle,
    merchant: "Corner Bakery",
  });

  expect(assigned.isError, assigned.text).toBe(false);
  expect(callAfter(assigned.text, "propose this rule to the user: rules ")).toMatchObject({
    conditions: [{ field: "label", operator: "contains", value: "PAYLINK *CORNER BAKERY" }],
    merchant: "Corner Bakery",
  });
  expect((await show(label)).text).toContain("Merchant: Corner Bakery, paid through Paylink.");
});

test("a transfer to a person is not paid through an intermediary", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Tatum",
  );

  const paidThrough = "CB LYDIA *CORNER BAKERY 03/11";
  // A transfer names its party through a marker (#194): its free text names no one.
  const transfer = "VIR SEPA EMIS /BEN LYDIA MARTIN 04/11";

  // One statement: the intermediary's cleaned label and a person's that starts with it.
  await upload([
    line("2026-11-03", -640, paidThrough, "LY0311"),
    line("2026-11-04", -2500, transfer, "LY0411"),
  ]);

  expect((await show(paidThrough)).text).toContain(
    `Paid through Lydia, a payment intermediary: ${ASKS}.`,
  );

  const person = await show(transfer);

  expect(person.text).toContain("Merchant: Lydia Martin.");
  expect(person.text).not.toContain("paid through");
  expect(person.text).not.toContain(ASKS);

  const found = await call("merchants", { action: "search", text: "lydia" });

  expect(found.text).toContain("- Lydia (payment intermediary): 1 cleaned label");
  expect(found.text).not.toContain("Lydia Martin (payment intermediary)");
});

test("a merge keeps the intermediary mark", async ({ app, user, page, mcpClientId }, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Umber",
  );

  const card = "CB PAYPAL *PIXELPLAY 21/10";

  // The direct debit's cleaned label, PAYPAL EUROPE, is a merchant of its own, not marked.
  await upload([
    line("2026-10-21", -1999, card, "PP2110"),
    line("2026-10-24", -1250, "PRLV SEPA PAYPAL EUROPE SARL", "PP2410"),
  ]);

  const merged = await call("merchants", {
    action: "merge",
    merchant: "Paypal",
    into: "Paypal Europe",
  });

  expect(merged.isError, merged.text).toBe(false);
  expect(merged.text).toContain("Merged Paypal into Paypal Europe");

  const found = await call("merchants", { action: "search", text: "paypal" });

  expect(found.text).toContain("- Paypal Europe (payment intermediary): 2 cleaned labels");
  expect((await show(card)).text).toContain(
    `Paid through Paypal Europe, a payment intermediary: ${ASKS}.`,
  );
});

test("marking a merchant set on lines makes them ask", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Vesper",
  );

  const label = "CB PAYPAL *PIXELPLAY 21/10";

  await upload([line("2026-10-21", -1999, label, "PP2110")]);

  const assigned = await call("merchants", {
    action: "assign",
    line: (await show(label)).handle,
    merchant: "Pixelplay",
  });

  expect(assigned.isError, assigned.text).toBe(false);
  expect((await show(label)).text).toContain("Merchant: Pixelplay, paid through Paypal.");

  const marked = await call("merchants", {
    action: "edit",
    merchant: "Pixelplay",
    intermediary: true,
  });

  expect(marked.isError, marked.text).toBe(false);

  // An intermediary is never who was paid: the line asks again.
  const asked = await show(label);

  expect(asked.text).toContain(`Paid through Paypal, a payment intermediary: ${ASKS}.`);
  expect(asked.text).not.toContain("Merchant: Pixelplay");

  // Nor does a rule set one.
  const refused = await call("rules", {
    action: "create",
    conditions: [{ field: "label", operator: "contains", value: "PAYPAL *PIXELPLAY" }],
    merchant: "Pixelplay",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("is a payment intermediary, never who was paid");
});

test("a merge into an intermediary makes its lines ask", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, show } = await intermediariesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Wren",
  );

  const label = "CB PAYPAL *PIXELPLAY 21/10";

  await upload([line("2026-10-21", -1999, label, "PP2110")]);

  const assigned = await call("merchants", {
    action: "assign",
    line: (await show(label)).handle,
    merchant: "Pixelplay",
  });

  expect(assigned.isError, assigned.text).toBe(false);

  const merged = await call("merchants", {
    action: "merge",
    merchant: "Pixelplay",
    into: "Paypal",
  });

  expect(merged.isError, merged.text).toBe(false);

  // The entry's merchant is now the intermediary: it counts as none, and the line asks.
  const asked = await show(label);

  expect(asked.text).toContain(`Paid through Paypal, a payment intermediary: ${ASKS}.`);
  expect(asked.text).not.toContain("Merchant: Paypal");
});
