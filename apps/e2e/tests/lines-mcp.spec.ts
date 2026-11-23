import type { Page } from "@playwright/test";
import type { Client } from "@modelcontextprotocol/client";
import { Schema } from "effect";

import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #21's MCP scenario: the `lines` tool, read only, through the official MCP client and the
// real OAuth flow, on the made-up lines and imports written into the user's own tables (two months
// of OFX statements). Other specs of the worker may add lines to the same user: counts are read
// from the result, never assumed.

let data: ReturnType<typeof openUserData>;

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  await data.seed(await data.ownerOf(user.email));
});

test.afterAll(async () => {
  await data.close();
});

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: string | number | boolean };

/** The text of the tool's answer, and whether it is an error. */
async function callLines(client: Client, args: Arguments) {
  const result = await client.callTool({ name: "lines", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const Written = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);

const NEXT = "More lines remain. Read them with: lines ";

/** The next call a search result writes, read back; undefined on the last page. */
function nextCall(text: string): Arguments | undefined {
  const at = text.indexOf(NEXT);

  if (at === -1) {
    return undefined;
  }

  const json = text.slice(at + NEXT.length).split("\n")[0] ?? "";

  return Schema.decodeUnknownSync(Written)(JSON.parse(json));
}

/** The handles a search result gives, in order. */
const handlesOf = (text: string) => [...text.matchAll(/; line: (\S+)$/gm)].map(([, id]) => id);

const AMOUNT = String.raw`-?[\d,]+\.\d\d EUR`;

test("an MCP client searches the lines by text and account, reads on with the next call, and shows a line with its import", async ({
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

  expect(session.client.getInstructions()).toContain("`lines`");

  // One line a page: the made-up salary comes each month, so there are two pages at least.
  let next: Arguments | undefined = {
    action: "search",
    text: "acme consulting",
    account: "Current account",
    institution: "Riverside Bank",
    limit: 1,
  };

  const seen: Array<string | undefined> = [];
  let total = 0;
  let first = "";

  while (next !== undefined) {
    const { text, isError } = await callLines(session.client, next);

    expect(isError, text).toBe(false);
    expect(text).toContain('containing "acme consulting", in Current account (Riverside Bank)');
    expect(text).toMatch(
      new RegExp(
        String.raw`\n- \d{4}-\d\d-\d\d, Current account \(Riverside Bank\): ${AMOUNT}, "SEPA TRF ACME CONSULTING SALARY"; line: \S+`,
      ),
    );

    total = Number(/^(\d+) line\(s\) match/.exec(text)?.[1] ?? "0");
    first = first === "" ? text : first;
    seen.push(...handlesOf(text));
    next = nextCall(text);

    expect(seen.length).toBeLessThanOrEqual(total);
  }

  expect(total).toBeGreaterThanOrEqual(2);
  expect(seen).toHaveLength(total);
  expect(new Set(seen).size).toBe(total);
  expect(first).toContain('"limit":1,"after":"');

  const [newest] = seen;
  const shown = await callLines(session.client, { action: "show", line: newest ?? "" });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toMatch(
    /^Line of Current account \(Riverside Bank\), booked on \d{4}-\d\d-\d\d\./,
  );
  expect(shown.text).toContain('Label: "SEPA TRF ACME CONSULTING SALARY"');
  expect(shown.text).toMatch(
    /\nImported from "current-\d{4}-\d\d\.ofx" \(OFX\) on \d{4}-\d\d-\d\d, covering \d{4}-\d\d-01 to \d{4}-\d\d-\d\d\.$/,
  );

  const unknown = await callLines(session.client, { action: "show", line: "not-a-line" });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('A valid call: lines {"action":"search"');
});
