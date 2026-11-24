import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #27 through the MCP door, with a real client and the real OAuth flow: `lines` `link` adds a
// payment or a refund to an expense, `split` splits a line across categories, `show` gives the
// expense once at its net cost and a cancellation proposed as a refund, `unlink` takes a line out.
// The user is the test's own; statements are imported as the import job runs them. Every amount
// and label is invented.

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = {
  readonly [key: string]:
    | string
    | ReadonlyArray<{ readonly category: string; readonly amount: string }>;
};

/** The text of the tool's answer, and whether it is an error. */
async function callLines(client: Client, args: Arguments) {
  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** The handles a search result gives, in order (newest first). */
const handlesOf = (text: string) =>
  [...text.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id ?? "");

/** Imports these lines into a new current account of the user's. */
async function importInto(
  owner: string,
  name: string,
  lines: ReadonlyArray<Omit<StatementLine, "reference">>,
) {
  const accountId = await imports.createAccount(owner, name);

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

test("an MCP client links a payment and a refund into one expense, splits a line and confirms a cancellation", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(90_000);

  const person = await addUser(app.baseURL, user, {
    name: "Ari Example",
    email: `ari.expenses.worker${app.slot}.${testInfo.repeatEachIndex}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-ari-password-${app.slot}`,
  });

  const owner = await data.ownerOf(person.email);

  await importInto(owner, "Everyday account", [
    { bookedOn: "2026-10-12", amountMinor: -2500, label: "CB HARBOR HOME 1210 RIVERTON" },
    {
      bookedOn: "2026-10-20",
      amountMinor: 2000,
      label: "VIR SEPA RECU /DE SAM EXAMPLE /MOTIF HOME",
    },
    { bookedOn: "2026-10-08", amountMinor: -9000, label: "CB LANTERN STORES 0810 RIVERTON" },
    { bookedOn: "2026-10-03", amountMinor: -5600, label: "CB CORNER BISTRO 0310 RIVERTON" },
    { bookedOn: "2026-10-06", amountMinor: 5600, label: "AVOIR CORNER BISTRO RIVERTON" },
  ]);

  await importInto(owner, "Travel card", [
    { bookedOn: "2026-10-12", amountMinor: -5000, label: "CB HARBOR HOME 1210 RIVERTON" },
  ]);

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const { client } = session;

  // A 75 expense paid 25 + 50 on two accounts counts 75 once.
  const home = await callLines(client, { action: "search", text: "harbor home" });
  const [onCard, onCurrent] = handlesOf(home.text);

  expect([onCard, onCurrent].every(Boolean), home.text).toBe(true);
  expect(home.text).toContain("Travel card");

  const linked = await callLines(client, {
    action: "link",
    line: onCard ?? "",
    into: onCurrent ?? "",
  });

  expect(linked.isError, linked.text).toBe(false);
  expect(linked.text).toContain("Linked as a payment.");
  expect(linked.text).toContain("counted once at its net cost of 75.00 EUR");
  expect(linked.text).toContain("- paid 25.00 EUR on 2026-10-12, Everyday account");
  expect(linked.text).toContain("- paid 50.00 EUR on 2026-10-12, Travel card");

  // A refund of 20 makes it 55.
  const [back] = handlesOf(
    (await callLines(client, { action: "search", text: "sam example" })).text,
  );

  const refunded = await callLines(client, {
    action: "link",
    line: back ?? "",
    into: onCard ?? "",
  });

  expect(refunded.isError, refunded.text).toBe(false);
  expect(refunded.text).toContain("Linked as a refund.");
  expect(refunded.text).toContain("counted once at its net cost of 55.00 EUR");

  const shown = await callLines(client, { action: "show", line: back ?? "" });

  expect(shown.text).toContain("- refunded 20.00 EUR on 2026-10-20, Everyday account");
  expect(shown.text).toContain("This line is one of its refunds.");

  // Linking it again is refused, saying why.
  const twice = await callLines(client, {
    action: "link",
    line: back ?? "",
    into: onCurrent ?? "",
  });

  expect(twice.isError).toBe(true);
  expect(twice.text).toContain("is already part of that expense");

  // A split line sums to the line.
  const [stores] = handlesOf(
    (await callLines(client, { action: "search", text: "lantern stores" })).text,
  );

  const split = await callLines(client, {
    action: "split",
    line: stores ?? "",
    shares: [
      { category: "Groceries", amount: "30" },
      { category: "Shopping > Home and garden", amount: "60.00" },
    ],
  });

  expect(split.isError, split.text).toBe(false);
  expect(split.text).toContain("across 2 categories, together the whole line");
  expect(split.text).toContain("- Groceries: 30.00 EUR");
  expect(split.text).toContain("- Shopping > Home and garden: 60.00 EUR");

  const wrongSum = await callLines(client, {
    action: "split",
    line: stores ?? "",
    shares: [
      { category: "Groceries", amount: "30" },
      { category: "Shopping", amount: "50" },
    ],
  });

  expect(wrongSum.isError).toBe(true);
  expect(wrongSum.text).toContain("The shares must add up to the line's absolute amount");
  expect(wrongSum.text).toContain('A valid call: lines {"action":"split"');

  // A cancellation is proposed as a refund, never applied unasked; the user confirms it.
  const [cancelled, purchase] = handlesOf(
    (await callLines(client, { action: "search", text: "corner bistro" })).text,
  );

  const proposed = await callLines(client, { action: "show", line: cancelled ?? "" });

  expect(proposed.text).toContain("Maybe a refund: this line may cancel all or part of an expense");
  expect(proposed.text).toContain(`line: ${purchase ?? ""}, in Other, costing 56.00 EUR`);
  expect(proposed.text).toContain("Category: Other (income)");

  const confirmed = await callLines(client, {
    action: "link",
    line: cancelled ?? "",
    into: purchase ?? "",
  });

  expect(confirmed.text).toContain("counted once at its net cost of 0.00 EUR");

  // Taken out again, the second payment is an expense of its own.
  const unlinked = await callLines(client, { action: "unlink", line: onCard ?? "" });

  expect(unlinked.isError, unlinked.text).toBe(false);
  expect(unlinked.text).toContain(
    "It is an expense of its own again, in Other, and counts 50.00 EUR.",
  );

  const alone = await callLines(client, { action: "unlink", line: onCard ?? "" });

  expect(alone.isError).toBe(true);
  expect(alone.text).toContain("is the only line of its expense");
});

test("a token allowed to read only cannot link, unlink nor split", async ({
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

  for (const action of ["link", "unlink", "split"]) {
    const refused = await callLines(session.client, { action, line: "any", into: "any" });

    expect(refused.isError, action).toBe(true);
    expect(refused.text, action).toContain("choose Read and write on Gousset's consent page");
  }
});
