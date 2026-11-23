import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account, importProfile } from "@gousset/db/schema/ledger";
import { encodeWindows1252, exampleStatement, writeStatement } from "@gousset/fixture";

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

/** The id of the import an upload's answer names. */
const importIdOf = (text: string) => /Import id: ([\da-f-]{36})/.exec(text)?.[1] ?? "";

/** An invented export in the French style shipped with Gousset; its days leave detection unsure. */
const frenchExport = encodeWindows1252(
  [
    "Relevé de compte",
    "Compte courant",
    "Période du 01/12/2026 au 12/12/2026",
    "Date;Date de valeur;Libellé;Débit;Crédit",
    '01/12/2026;01/12/2026;"CB MARCHÉ DES HALLES";18,40;',
    '03/12/2026;03/12/2026;"VIR SEPA DOMINIQUE EXEMPLE";;75,00',
    "",
  ].join("\r\n"),
);

/** An invented export no shipped profile knows, which the user's own profile reads. */
const ownExport = [
  "Day|Money|What",
  "2026-12-04|-12.50|EXAMPLE BAKERY",
  "2026-12-06|-30.00|EXAMPLE BOOKSHOP",
  "",
].join("\n");

test("reads CSV files with the user's profile and a shipped one, and says which profiles read them", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(90_000);

  const reader = await addUser(app.baseURL, user, {
    name: "Alex Example",
    email: `alex.profiles.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-alex-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(reader.email);

    await data.asUser(owner, async (transaction) => {
      await transaction
        .insert(account)
        .values({ userId: owner, name: ACCOUNT_NAME, kind: "current", currency: "EUR" });

      await transaction.insert(importProfile).values([
        {
          userId: owner,
          name: "Pipe export",
          institution: "Example Credit Union",
          header: "day;money;what",
          definition: {
            version: 1,
            separator: "|",
            encoding: "utf8",
            skipRows: 0,
            headerRow: true,
            dateFormat: "YYYY-MM-DD",
            decimalMark: ".",
            columns: {
              bookedOn: 1,
              valueOn: null,
              amount: { kind: "signed", column: 2 },
              label: 3,
              memo: null,
              bankId: null,
              currency: null,
            },
          },
        },
        // A row whose definition no longer reads: listed as such, never a failure.
        { userId: owner, name: "Broken export", definition: { version: 1 } },
      ]);
    });
  } finally {
    await data.close();
  }

  await page.context().addCookies([...reader.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const listed = await callText(session.client, "imports", { action: "profiles" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain(
    "- Pipe export (Example Credit Union), the user's: separated by pipes",
  );
  expect(listed.text).toContain(
    "- Broken export, the user's: its definition can no longer be read",
  );
  expect(listed.text).toContain(
    "- French style: debit and credit columns, shipped with Gousset: separated by semicolons, encoded windows-1252",
  );

  const french = await callText(session.client, "imports", {
    action: "upload",
    file_name: "releve-decembre.csv",
    content_base64: Buffer.from(frenchExport).toString("base64"),
    account: ACCOUNT_NAME,
  });

  expect(french.isError, french.text).toBe(false);
  expect(french.text).toContain("2 lines read: 2 added");

  const frenchProfiles = await callText(session.client, "imports", {
    action: "profiles",
    import: importIdOf(french.text),
  });

  expect(frenchProfiles.isError, frenchProfiles.text).toBe(false);
  expect(frenchProfiles.text).toContain(
    "- French style: debit and credit columns, shipped with Gousset: its header row is the file's.",
  );
  expect(frenchProfiles.text).toContain(
    "This import read its file with French style: debit and credit columns.",
  );

  const own = await callText(session.client, "imports", {
    action: "upload",
    file_name: "own-export.csv",
    content: ownExport,
    account: ACCOUNT_NAME,
  });

  expect(own.isError, own.text).toBe(false);
  expect(own.text).toContain("2 lines read: 2 added");

  const ownProfiles = await callText(session.client, "imports", {
    action: "profiles",
    import: importIdOf(own.text),
  });

  expect(ownProfiles.text).toContain(
    "- Pipe export (Example Credit Union), the user's: its header row is the file's.",
  );
  expect(ownProfiles.text).toContain("This import read its file with Pipe export.");
});
