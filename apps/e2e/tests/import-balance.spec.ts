import { writeFile } from "node:fs/promises";

import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";
import { accountBalance } from "@gousset/db/schema/ledger";
import { asc, eq } from "drizzle-orm";

import { addUser } from "../src/auth";
import type { TestUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { animationsDone, connectMcp, expect, fixDay, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #130, "How to verify": some banks write a closing balance of 0.00 although the account is
// not empty. A balance of zero that the account's lines contradict on its day is treated as not
// given: no statement balance is recorded, and the import's summary says so, on the screen and
// through the MCP door. A file whose lines do make zero keeps its zero balance. Such a balance an
// earlier import kept stays in its table, and the account's check reads past it. Each test imports
// into accounts of its own, of a user of its own, through `@gousset/core` as the import job runs it.

/** The example statement from an empty account, with a closing balance its lines contradict. */
const emptyBalance: Statement = {
  ...exampleStatement,
  openingBalanceMinor: 0,
  statedClosingBalanceMinor: 0,
};

/** A month whose lines make zero: money in, then the same money out. */
const evenMonth: Statement = {
  ...exampleStatement,
  openingBalanceMinor: 0,
  lines: [
    {
      bookedOn: "2026-10-02",
      amountMinor: 50_000,
      label: "VIR SEPA CAMILLE EXEMPLE",
      reference: "EVEN2026100201",
    },
    {
      bookedOn: "2026-10-20",
      amountMinor: -50_000,
      label: "VIR SEPA LIVRET EXEMPLE",
      reference: "EVEN2026102001",
    },
  ],
};

/** The formats whose files give a closing balance. */
const WITH_A_BALANCE = ["ofx", "camt053", "mt940"] as const;

const NOTE = "This file's balance looks empty and was ignored";

/** The statement balances an import recorded, oldest first. */
const balancesOf = (data: ReturnType<typeof openUserData>, owner: string, importId: string) =>
  data.asUser(owner, (transaction) =>
    transaction
      .select({ day: accountBalance.day, minor: accountBalance.balanceMinor })
      .from(accountBalance)
      .where(eq(accountBalance.importId, importId))
      .orderBy(asc(accountBalance.day)),
  );

/**
 * The day each format's opening balance is read into, the end of that day (packages/import's
 * README): CAMT.053's `OPBD` of 1 October is the end of 30 September; MT940's `:60F:` of 1 October,
 * with no line booked by then, the end of 1 October.
 */
const OPENING_DAY = { ofx: null, camt053: "2026-09-30", mt940: "2026-10-01" } as const;

async function importer(app: { baseURL: string; slot: number }, admin: TestUser, name: string) {
  return addUser(app.baseURL, admin, {
    name: "Noa Example",
    email: `noa.${name}.worker${app.slot}.${crypto.randomUUID().slice(0, 8)}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
  });
}

test("a file with lines and a zero LEDGERBAL records no balance, and the summary notes it", async ({
  app,
  user,
}) => {
  const person = await importer(app, user, "empty");
  const data = openUserData(app.database);

  try {
    const imports = importsOn(data);
    const owner = await data.ownerOf(person.email);

    for (const format of WITH_A_BALANCE) {
      const accountId = await imports.createAccount(owner, `Empty balance ${format}`);
      const file = statementFile(format, emptyBalance);
      const summary = await imports.importFile(owner, accountId, file);

      expect(summary, format).toMatchObject({
        status: "done",
        linesAdded: emptyBalance.lines.length,
        balanceIgnored: true,
      });

      // OFX gives the closing balance only. CAMT.053 and MT940 also give an opening balance of
      // zero, which the empty account agrees with before its first line: that one stays.
      const opening = OPENING_DAY[format];

      expect(await balancesOf(data, owner, summary.id), format).toEqual(
        opening === null ? [] : [{ day: opening, minor: 0 }],
      );
    }
  } finally {
    await data.close();
  }
});

test("a file whose lines sum to zero keeps its zero balance", async ({ app, user }) => {
  const person = await importer(app, user, "even");
  const data = openUserData(app.database);

  try {
    const imports = importsOn(data);
    const owner = await data.ownerOf(person.email);

    for (const format of WITH_A_BALANCE) {
      const accountId = await imports.createAccount(owner, `Even month ${format}`);
      const summary = await imports.importFile(owner, accountId, statementFile(format, evenMonth));

      expect(summary, format).toMatchObject({
        status: "done",
        linesAdded: 2,
        balanceIgnored: false,
      });

      const opening = OPENING_DAY[format];

      expect(await balancesOf(data, owner, summary.id), format).toEqual([
        ...(opening === null ? [] : [{ day: opening, minor: 0 }]),
        { day: "2026-10-31", minor: 0 },
      ]);
    }
  } finally {
    await data.close();
  }
});

test("an empty balance an earlier import kept shows no false gap on the account's page", async ({
  app,
  user,
  page,
}) => {
  const person = await importer(app, user, "kept");
  const data = openUserData(app.database);
  let accountId = "";

  try {
    const imports = importsOn(data);
    const owner = await data.ownerOf(person.email);

    accountId = await imports.createAccount(owner, "Kept balances");

    const summary = await imports.importFile(owner, accountId, statementFile("ofx", emptyBalance));

    // As an import before #130 kept them: the bank's 0.00 of 31 October, which the account's
    // lines contradict, and a balance of 21 October that they agree with.
    await data.asUser(owner, (transaction) =>
      transaction.insert(accountBalance).values([
        {
          userId: owner,
          accountId,
          day: "2026-10-21",
          balanceMinor: 155_544,
          source: "statement",
          importId: summary.id,
        },
        {
          userId: owner,
          accountId,
          day: "2026-10-31",
          balanceMinor: 0,
          source: "statement",
          importId: summary.id,
        },
      ]),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, "2026-10-31");
  await visit(page, `/accounts/${accountId}`);
  await expect(page.getByText("Balance checked")).toBeVisible();
  await expect(page.getByText("Balance does not match")).toHaveCount(0);
});

/** A file's summary on the import screen, by its name. */
const summaryOf = (page: Page, file: string) =>
  page.getByRole("region", { name: `What ${file} brought` });

test("the import screen says a file's empty balance was ignored", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(90_000);

  const person = await importer(app, user, "screen");
  const data = openUserData(app.database);

  try {
    await importsOn(data).createAccount(
      await data.ownerOf(person.email),
      "Everyday account",
      exampleStatement.account.iban,
    );
  } finally {
    await data.close();
  }

  const file = writeStatement("camt053", emptyBalance);
  const path = testInfo.outputPath(file.fileName);

  await writeFile(path, file.contents, "utf8");
  await page.context().addCookies([...person.cookies]);
  await visit(page, "/import");
  await page.locator('[data-slot="file-drop-input"]').setInputFiles(path);
  await expect(summaryOf(page, file.fileName)).toBeVisible({ timeout: 30_000 });
  await expect(summaryOf(page, file.fileName).getByText(NOTE)).toBeVisible();
  await animationsDone(page);
});

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

test("the MCP door says a file's empty balance was ignored", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const person = await importer(app, user, "mcp");
  const data = openUserData(app.database);

  try {
    await importsOn(data).createAccount(
      await data.ownerOf(person.email),
      "Everyday account",
      exampleStatement.account.iban,
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: (consent) => consent.getByRole("button", { name: "Allow read and write" }).click(),
    scope: "read write",
    clientId: mcpClientId,
  });

  const file = writeStatement("camt053", emptyBalance);

  const uploaded = await callText(session.client, "imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);
  expect(uploaded.text).toContain(`Imported ${file.fileName} into Everyday account`);
  expect(uploaded.text).toContain("The file's balance looks empty and was ignored");

  const importId = /Import id: ([\da-f-]{36})/.exec(uploaded.text)?.[1] ?? "";
  const status = await callText(session.client, "imports", { action: "status", import: importId });

  expect(status.isError, status.text).toBe(false);
  expect(status.text).toContain("The file's balance looks empty and was ignored");
});
