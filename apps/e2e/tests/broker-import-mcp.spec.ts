import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 2, through the MCP door: a broker's export of operations uploaded with the
// `imports` tool by the official MCP client, over the real OAuth flow, against the built app, its
// job queue and a real Postgres. Gousset ships no broker's profile: the agent writes one for the
// file (its columns, the words of its kinds, its formats), test-reads it on the file, keeps it and
// imports with it, with the same checks as the import screen. The Fortuneo file is invented, its
// ISIN in the country code XX.

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const PEA = "Harbour PEA";
const EVERYDAY = "Everyday account";

/** An invented Fortuneo export: two operations, their days the 12th or before. */
const fortuneo = encodeWindows1252(
  [
    "Date;Opération;Libellé;Code ISIN;Qté;Prix d'exé;Montant brut;Courtage;Montant net;Devise",
    "02/12/2026;Versement espèces;VIREMENT;;;;;;300,00;EUR",
    "03/12/2026;Achat Comptant;FORTUNE WORLD ETF;XX0000000028;10;25,10;-251,00;-1,95;-252,95;EUR",
    "",
  ].join("\r\n"),
);

/** The profile an agent writes for the file, by its columns' places; `words` its kind words. */
const profileFor = (words: ReadonlyArray<{ word: string; kind: string }>) =>
  JSON.stringify({
    version: 2,
    reads: "operations",
    separator: ";",
    encoding: "windows-1252",
    skipRows: 0,
    headerRow: true,
    dateFormat: "DD/MM/YYYY",
    decimalMark: ",",
    columns: {
      bookedOn: 1,
      kind: 2,
      securityName: 3,
      label: 3,
      isin: 4,
      quantity: 5,
      unitPrice: 6,
      fees: 8,
      amount: 9,
      amountCurrency: 10,
    },
    kinds: words,
    referenceUnique: false,
  });

const DEPOSIT = { word: "Versement espèces", kind: "deposit" };

const PURCHASE = { word: "Achat Comptant", kind: "purchase" };

test("an agent writes a broker's profile, test-reads it, keeps it and imports with it, once, into an investment account only", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const investor = await addUser(app.baseURL, user, {
    name: "Kai Example",
    email: `kai.brokers.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-kai-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(investor.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values([
        { userId: owner, name: PEA, kind: "investment", envelope: "pea", currency: "EUR" },
        { userId: owner, name: EVERYDAY, kind: "current", currency: "EUR" },
      ]),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...investor.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = (args: { [key: string]: string }) => callText(session.client, "imports", args);

  // No broker's profile is shipped.
  const profiles = await call({ action: "profiles" });

  expect(profiles.isError, profiles.text).toBe(false);
  expect(profiles.text).not.toContain("for a broker's operations");

  const upload = (fileName: string, accountName: string) =>
    call({
      action: "upload",
      file_name: fileName,
      content_base64: Buffer.from(fortuneo).toString("base64"),
      account: accountName,
    });

  // No profile reads it: it waits for its columns, and the answer says how to map them here.
  const waiting = await upload("fortuneo-december.csv", PEA);

  expect(waiting.isError, waiting.text).toBe(false);
  expect(waiting.text).toContain("waits for its CSV columns to be confirmed");
  expect(waiting.text).toContain('"action":"test_profile"');

  const importId = /"import":"([\da-f-]{36})"/.exec(waiting.text)?.[1] ?? "";

  expect(importId).not.toBe("");

  // A kind word the profile does not list is refused at its line and column, never guessed.
  const partial = await call({
    action: "test_profile",
    import: importId,
    profile_json: profileFor([DEPOSIT]),
  });

  expect(partial.isError, partial.text).toBe(false);
  expect(partial.text).toContain('First row: 1 "Date", 2 "Opération", 3 "Libellé"');
  expect(partial.text).toContain(
    'The profile does not read this file: InvalidField at line 3, column 2, field kind, value "Achat Comptant".',
  );

  // Kept before it reads the file: refused, as the import screen's button is disabled.
  const tooSoon = await call({
    action: "save_profile",
    import: importId,
    name: "Fortuneo by the agent",
    profile_json: profileFor([DEPOSIT]),
  });

  expect(tooSoon.isError).toBe(true);

  const tested = await call({
    action: "test_profile",
    import: importId,
    profile_json: profileFor([DEPOSIT, PURCHASE]),
  });

  expect(tested.isError, tested.text).toBe(false);
  expect(tested.text).toContain("- 2026-12-02, deposit, VIREMENT, 300.00 EUR");
  expect(tested.text).toContain("- 2026-12-03, purchase, FORTUNE WORLD ETF, -252.95 EUR");

  const saved = await call({
    action: "save_profile",
    import: importId,
    name: "Fortuneo by the agent",
    profile_json: profileFor([DEPOSIT, PURCHASE]),
  });

  expect(saved.isError, saved.text).toBe(false);
  expect(saved.text).toContain(
    "Saved Fortuneo by the agent as the user's profile, for a broker's operations",
  );

  const confirmed = await call({
    action: "confirm",
    import: importId,
    profile: "Fortuneo by the agent",
  });

  expect(confirmed.isError, confirmed.text).toBe(false);
  expect(confirmed.text).toContain(`Imported fortuneo-december.csv into ${PEA}`);
  expect(confirmed.text).toContain("Read as a broker's operations with Fortuneo by the agent.");
  expect(confirmed.text).toContain("2 operations read: 2 added, 0 already known (duplicates).");

  // Kept with the file's header: the next such file is read with it on upload, nothing twice.
  const again = await upload("fortuneo-december-again.csv", PEA);

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain("Read as a broker's operations with Fortuneo by the agent.");
  expect(again.text).toContain("2 operations read: 0 added, 2 already known (duplicates).");

  const refused = await upload("fortuneo-on-current.csv", EVERYDAY);

  expect(refused.text).toContain("failed");
  expect(refused.text).toContain(
    "A broker's operations go only into an investment account kept by its lines.",
  );
});
