import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { encodeWindows1252 } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250, part 2, through the MCP door: a broker's export of operations uploaded with the
// `imports` tool by the official MCP client, over the real OAuth flow, against the built app, its
// job queue and a real Postgres. The Fortuneo file is invented, its ISIN in the country code XX.

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

/** An invented Fortuneo export, in the header Gousset's shipped profile reads: two operations. */
const fortuneo = encodeWindows1252(
  [
    "Date;Opération;Libellé;Code ISIN;Qté;Prix d'exé;Montant brut;Courtage;Montant net;Devise",
    "02/12/2026;Versement espèces;VIREMENT;;;;;;300,00;EUR",
    "03/12/2026;Achat Comptant;FORTUNE WORLD ETF;XX0000000028;10;25,10;-251,00;-1,95;-252,95;EUR",
    "",
  ].join("\r\n"),
);

test("imports a broker's operations through the MCP client, once, into an investment account only", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(90_000);

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

  const profiles = await callText(session.client, "imports", { action: "profiles" });

  expect(profiles.isError, profiles.text).toBe(false);
  expect(profiles.text).toContain(
    "- Fortuneo: history of operations, shipped with Gousset, for a broker's operations: a broker's operations, Fortuneo's history of operations, its columns found by their names, into an investment account.",
  );

  const upload = (fileName: string, accountName: string) =>
    callText(session.client, "imports", {
      action: "upload",
      file_name: fileName,
      content_base64: Buffer.from(fortuneo).toString("base64"),
      account: accountName,
    });

  const first = await upload("fortuneo-december.csv", PEA);

  expect(first.isError, first.text).toBe(false);
  expect(first.text).toContain(`Imported fortuneo-december.csv into ${PEA}`);
  expect(first.text).toContain(
    "Read as a broker's operations with Fortuneo: history of operations.",
  );
  expect(first.text).toContain("2 operations read: 2 added, 0 already known (duplicates).");

  const again = await upload("fortuneo-december-again.csv", PEA);

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain("2 operations read: 0 added, 2 already known (duplicates).");

  const refused = await upload("fortuneo-on-current.csv", EVERYDAY);

  expect(refused.text).toContain("failed");
  expect(refused.text).toContain(
    "A broker's operations go only into an investment account kept by its lines.",
  );
});
