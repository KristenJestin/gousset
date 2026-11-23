import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #20 through the MCP door: the `imports` tool, called by the official MCP client over the
// real OAuth flow, against the built app, its job queue and a real Postgres.

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const ACCOUNT_NAME = "Everyday account";

test("imports a statement through the MCP client, then lists and undoes it", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // Two uploads, each waiting for the app's import job.
  test.setTimeout(90_000);

  // A user of the test's own, so that no other test's accounts or lines meet this statement.
  const importer = await addUser(app.baseURL, user, {
    name: "Robin Example",
    email: `robin.imports.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-robin-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(importer.email);

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

  await page.context().addCookies([...importer.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const statement = writeStatement("camt053", exampleStatement);

  const upload = () =>
    callText(session.client, "imports", {
      action: "upload",
      file_name: statement.fileName,
      content: statement.contents,
    });

  const first = await upload();

  expect(first.isError, first.text).toBe(false);
  expect(first.text).toContain(`Imported ${statement.fileName} into ${ACCOUNT_NAME}`);
  expect(first.text).toContain("6 lines read: 6 added, 0 already known (duplicates)");

  const firstId = /Import id: ([\da-f-]{36})/.exec(first.text)?.[1] ?? "";

  expect(firstId).not.toBe("");

  const again = await upload();

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toMatch(
    /^This same file was already imported, as .+: nothing is added twice\./,
  );
  expect(again.text).toContain("6 lines read: 0 added, 6 already known (duplicates)");

  const listed = await callText(session.client, "imports", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(
    listed.text.split("\n").filter((line) => line.startsWith(`- ${statement.fileName}, `)),
  ).toHaveLength(2);
  expect(listed.text).toContain(`Id: ${firstId}`);

  const undone = await callText(session.client, "imports", { action: "undo", import: firstId });

  expect(undone.isError, undone.text).toBe(false);
  expect(undone.text).toContain(`Undid the import of ${statement.fileName} (${ACCOUNT_NAME}`);
  expect(undone.text).toContain("6 lines removed.");
});
