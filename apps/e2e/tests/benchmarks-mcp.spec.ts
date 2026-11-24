import type { Client } from "@modelcontextprotocol/client";

import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #33's MCP scenarios: `month benchmarks`, through the official MCP client and the real OAuth
// flow, on a user of its own seeded with the made-up data of September and October 2026, each
// expense in "Other" until classified. Their data starts in September: October's automatic
// benchmarks average that one month.

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

type Arguments = { readonly [key: string]: string | number | boolean };

async function callTool(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** An expense of the month still in "Other": its handle, and what it cost, as `month` writes it. */
async function expenseInOther(client: Client, month: string) {
  const { text, isError } = await callTool(client, "lines", {
    action: "search",
    from: `${month}-01`,
    to: `${month}-28`,
    limit: 100,
  });

  expect(isError, text).toBe(false);

  const [, cost = "", line = ""] =
    /: -([\d,]+\.\d\d EUR), ".*", in Other; line: (\S+)$/m.exec(text) ?? [];

  expect(line, text).not.toBe("");

  return { line, cost };
}

const benchmarks = (client: Client) =>
  callTool(client, "month", { action: "benchmarks", month: "2026-10" });

test("month benchmarks says each category's benchmark and flags the ones above it", async ({
  page,
  app,
  user,
  baseURL,
  mcpClientId,
}) => {
  const berenice = await addUser(app.baseURL, user, personOfItsOwn("berenice"));

  await data.seed(await data.ownerOf(berenice.email));
  await page.context().addCookies([...berenice.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: (consent) => consent.getByRole("button", { name: "Allow read and write" }).click(),
    scope: "read write",
    clientId: mcpClientId,
  });

  expect(client.getInstructions()).toContain("Its benchmarks");

  const first = await benchmarks(client);

  expect(first.isError, first.text).toBe(false);
  expect(first.text).toContain(
    "Benchmarks of 2026-10, in EUR: automatic benchmarks average 1 month(s) of 2026-04 to 2026-09",
  );
  expect(first.text).toMatch(
    /\n- Other: spent [\d,]+\.\d\d EUR; benchmark [\d,]+\.\d\d EUR \(automatic\)/,
  );

  // One October expense in a category of its own, its benchmark set under what it cost.
  const october = await expenseInOther(client, "2026-10");

  const made = await callTool(client, "categories", {
    action: "create",
    name: "Treats",
    benchmark: "0",
  });

  expect(made.isError, made.text).toBe(false);

  const classified = await callTool(client, "lines", {
    action: "classify",
    line: october.line,
    category: "Treats",
  });

  expect(classified.isError, classified.text).toBe(false);

  const drifting = await benchmarks(client);

  expect(drifting.text).toContain(
    `\n- Treats: spent ${october.cost}; benchmark 0.00 EUR (set); DRIFTS, ${october.cost} above`,
  );
  expect(drifting.text).toMatch(
    new RegExp(
      String.raw`\nDrifting above their benchmark: .*Treats \(${october.cost.replaceAll(".", String.raw`\.`)}, `,
    ),
  );

  // Reached is not passed.
  await callTool(client, "categories", {
    action: "edit",
    category: "Treats",
    benchmark: october.cost.replace(" EUR", "").replaceAll(",", ""),
  });

  const reached = await benchmarks(client);

  expect(reached.text).toContain(
    `\n- Treats: spent ${october.cost}; benchmark ${october.cost} (set)`,
  );
  // Treats is the one benchmark set.
  expect(reached.text).not.toContain("(set); DRIFTS");

  // Without a benchmark, nothing drifts.
  await callTool(client, "categories", { action: "edit", category: "Treats", benchmark: "none" });

  expect((await benchmarks(client)).text).toContain(
    `\n- Treats: spent ${october.cost}; no benchmark`,
  );

  // Automatic: September's expense in it is the one month averaged.
  const september = await expenseInOther(client, "2026-09");

  await callTool(client, "lines", { action: "classify", line: september.line, category: "Treats" });
  await callTool(client, "categories", {
    action: "edit",
    category: "Treats",
    benchmark: "automatic",
  });

  expect((await benchmarks(client)).text).toContain(
    `\n- Treats: spent ${october.cost}; benchmark ${september.cost} (automatic)`,
  );
});

test("month benchmarks of a user with no data yet has no automatic benchmark", async ({
  page,
  app,
  user,
  baseURL,
  mcpClientId,
}) => {
  const clement = await addUser(app.baseURL, user, personOfItsOwn("clement"));

  await page.context().addCookies([...clement.cookies]);

  const { client } = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: (consent) => consent.getByRole("button", { name: "Allow read only" }).click(),
    scope: "read write",
    clientId: mcpClientId,
  });

  const { text, isError } = await benchmarks(client);

  expect(isError, text).toBe(false);
  expect(text).toContain("no full month from 2026-04 to 2026-09 holds the user's data");
  expect(text).toContain("Nothing drifts above its benchmark.");
  expect(text).toContain(
    "\n- Groceries: spent 0.00 EUR; benchmark: none yet (automatic, nothing spent in it in those months)",
  );
});
