import type { Client } from "@modelcontextprotocol/client";
import { request } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sweepUploads } from "@gousset/core";
import { account, importUpload } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import { Effect } from "effect";

import { addUser, personOfItsOwn } from "../src/auth";
import type { TestUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #129, "How to verify": an agent imports a large statement without sending its bytes. The
// official MCP client, over the real OAuth flow, makes a file upload; the test sends the file to
// its address over plain HTTP, as curl does from an agent's shell; the import runs on the built
// app, its job queue and a real Postgres. Each test has a user of its own.

const ACCOUNT_NAME = "Everyday account";

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, args: { [key: string]: string | number }) {
  const result = await client.callTool({ name: "imports", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const DAY_MS = 86_400_000;

/**
 * Three years of an invented current account, 3,000 lines: about 1.3 MB as CAMT.053, the size of
 * the export the issue speaks of, hundreds of thousands of tokens were it sent in a tool call.
 */
function largeStatement() {
  const start = Date.UTC(2024, 0, 1);
  const days = 1000;

  const lines = Array.from({ length: 3000 }, (_, n) => ({
    bookedOn: new Date(start + Math.floor((n * days) / 3000) * DAY_MS).toISOString().slice(0, 10),
    amountMinor: n % 30 === 0 ? 245_000 : -(100 + ((n * 37) % 9000)),
    label:
      n % 30 === 0 ? `VIR SEPA ACME CONSEIL SALAIRE ${n}` : `CB EXEMPLE MAGASIN ${n % 97} ${n}`,
    reference: `UP${String(n).padStart(8, "0")}`,
  }));

  return writeStatement("camt053", {
    ...exampleStatement,
    from: "2024-01-01",
    to: new Date(start + days * DAY_MS).toISOString().slice(0, 10),
    lines,
  });
}

type Importer = { person: TestUser; owner: string; client: Client; page: Page };

/** A user of the test's own, with the account the example statements name, and their client. */
async function importer(
  app: { baseURL: string; database: string },
  admin: TestUser,
  page: Page,
  mcpClientId: string,
  local: string,
  consent = allowReadAndWrite,
): Promise<Importer> {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));
  const data = openUserData(app.database);
  let owner = "";

  try {
    owner = await data.ownerOf(person.email);

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

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent,
    scope: consent === allowReadOnly ? "read" : "read write",
    clientId: mcpClientId,
  });

  return { person, owner, client: session.client, page };
}

/** A file upload made through the client: its id and its address. */
async function createUpload(client: Client, args: { [key: string]: string | number }) {
  const made = await callText(client, { action: "create_upload", ...args });

  expect(made.isError, made.text).toBe(false);

  const id = /File upload id: ([\da-f-]{36})/.exec(made.text)?.[1] ?? "";
  const address = /^curl -sS(?: -F part=1)? -F '[^']*' (\S+)$/m.exec(made.text)?.[1] ?? "";

  expect(id, made.text).not.toBe("");
  expect(address, made.text).toMatch(/\/api\/import-uploads\/[\w-]+\.[\da-f-]{36}\.[\w-]{43}$/);

  return { id, address, text: made.text };
}

/**
 * Sends `bytes` to an upload address as `curl -F file=@<name>` does: a multipart form, its field
 * `file`, and `part` when numbered. No cookie, no origin: what a shell sends.
 */
async function send(
  address: string,
  bytes: Uint8Array,
  options: { name?: string; part?: number; headers?: { [name: string]: string } } = {},
) {
  const context = await request.newContext();

  const multipart = new FormData();

  multipart.set("file", new Blob([Buffer.from(bytes)]), options.name ?? "statement.xml");

  if (options.part !== undefined) {
    multipart.set("part", String(options.part));
  }

  try {
    const answer = await context.post(address, { multipart, headers: options.headers ?? {} });

    return { status: answer.status(), text: await answer.text() };
  } finally {
    await context.dispose();
  }
}

/** The file uploads the user has, as their own transaction sees them. */
async function uploadsOf(database: string, owner: string) {
  const data = openUserData(database);

  try {
    return await data.asUser(owner, (transaction) =>
      transaction.select({ id: importUpload.id }).from(importUpload),
    );
  } finally {
    await data.close();
  }
}

/** Waits for the import an upload's answer names to be done, and answers its status. */
async function importDone(client: Client, uploaded: string) {
  // Done or waiting, the answer names it; still running, it writes the status call to follow it.
  const importId = /(?:Import id: |"import":")([\da-f-]{36})/.exec(uploaded)?.[1] ?? "";

  expect(importId, uploaded).not.toBe("");

  let status = "";

  await expect
    .poll(
      async () => {
        status = (await callText(client, { action: "status", import: importId })).text;

        return status;
      },
      { timeout: 60_000 },
    )
    .toContain("done: all 3 steps");

  return status;
}

const small = () => {
  const statement = writeStatement("camt053", exampleStatement);

  return { fileName: statement.fileName, bytes: new TextEncoder().encode(statement.contents) };
};

test("a real client creates a file upload, a large invented file is sent to it, and status shows the import done", async ({
  app,
  user,
  page,
  mcpClientId,
}) => {
  test.setTimeout(120_000);

  const { client, owner } = await importer(app, user, page, mcpClientId, "robin");
  const statement = largeStatement();
  const bytes = new TextEncoder().encode(statement.contents);

  // Larger than any request the MCP door would take in base64, near it as text.
  expect(bytes.byteLength).toBeGreaterThan(1_000_000);

  const upload = await createUpload(client, {
    file_name: "three-years.xml",
    size: bytes.byteLength,
  });

  expect(upload.text).toContain(`curl -sS -F 'file=@three-years.xml' ${upload.address}`);

  const sent = await send(upload.address, bytes, { name: "three-years.xml" });

  expect(sent.status, sent.text).toBe(200);
  expect(sent.text).toContain(`${bytes.byteLength} bytes, the whole file`);
  expect(sent.text).toContain(`"file_upload":"${upload.id}"`);

  const arrived = await callText(client, { action: "status", file_upload: upload.id });

  expect(arrived.text).toContain(`three-years.xml: uploaded, whole (${bytes.byteLength} bytes)`);

  const imported = await callText(client, { action: "upload", file_upload: upload.id });

  expect(imported.isError, imported.text).toBe(false);

  const status = await importDone(client, imported.text);

  expect(status).toContain(`three-years.xml (camt053): done`);
  expect(status).toContain(`Account: ${ACCOUNT_NAME}.`);
  expect(status).toContain("3000 lines read: 3000 added, 0 already known (duplicates)");

  // Imported, the file upload is gone: its import keeps the file.
  expect(await uploadsOf(app.database, owner)).toEqual([]);

  const after = await callText(client, { action: "status", file_upload: upload.id });

  expect(after.isError).toBe(true);
  expect(after.text).toContain("no file upload");
});

test("a reused file upload is refused", async ({ app, user, page, mcpClientId }) => {
  test.setTimeout(90_000);

  const { client } = await importer(app, user, page, mcpClientId, "sasha");
  const { fileName, bytes } = small();
  const upload = await createUpload(client, { file_name: fileName, size: bytes.byteLength });

  expect((await send(upload.address, bytes)).status).toBe(200);

  const first = await callText(client, { action: "upload", file_upload: upload.id });

  expect(first.isError, first.text).toBe(false);
  await importDone(client, first.text);

  const again = await callText(client, { action: "upload", file_upload: upload.id });

  expect(again.isError).toBe(true);
  expect(again.text).toContain("imported already (a file upload is imported once)");
  expect(again.text).toContain('A valid call: imports {"action":"create_upload"');

  // Its address takes nothing more either.
  const resent = await send(upload.address, bytes);

  expect(resent.status).toBe(404);
  expect(resent.text).toContain("No file upload waits at this address");
});

test("an expired file upload is refused", async ({ app, user, page, mcpClientId }) => {
  test.setTimeout(90_000);

  const { client, owner } = await importer(app, user, page, mcpClientId, "noa");
  const { fileName, bytes } = small();
  const upload = await createUpload(client, { file_name: fileName, size: bytes.byteLength });

  expect(upload.text).toContain("(15 minutes)");
  expect((await send(upload.address, bytes)).status).toBe(200);

  // Its fifteen minutes past, as the clock would make them: expired a second ago, which the sweep
  // job, scheduled in this app too, leaves for ten minutes more.
  const expireAt = async (expiresAt: Date) => {
    const data = openUserData(app.database);

    try {
      await data.asUser(owner, (transaction) =>
        transaction.update(importUpload).set({ expiresAt }),
      );
    } finally {
      await data.close();
    }
  };

  await expireAt(new Date(Date.now() - 1000));

  const status = await callText(client, { action: "status", file_upload: upload.id });

  expect(status.text).toContain(`${fileName}: expired at`);

  const imported = await callText(client, { action: "upload", file_upload: upload.id });

  expect(imported.isError).toBe(true);
  expect(imported.text).toContain("This file upload expired at");

  const resent = await send(upload.address, bytes);

  expect(resent.status).toBe(410);

  // Expired long enough, the sweep deletes it with what it received: this call, or the scheduled
  // job if it ran meanwhile; either way, nothing is left.
  await expireAt(new Date(Date.now() - 3_600_000));

  const sweeping = openUserData(app.database);

  try {
    expect(
      await Effect.runPromise(sweepUploads(owner).pipe(Effect.provide(sweeping.layer))),
    ).toBeLessThanOrEqual(1);
  } finally {
    await sweeping.close();
  }

  expect(await uploadsOf(app.database, owner)).toEqual([]);
});

test("a file sent in parts, in order, is imported whole", async ({
  app,
  user,
  page,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client } = await importer(app, user, page, mcpClientId, "eden");
  const { fileName, bytes } = small();
  const cut = [0, 500, 1000, bytes.byteLength];

  const upload = await createUpload(client, {
    file_name: fileName,
    size: bytes.byteLength,
    parts: 3,
  });

  expect(upload.text).toContain("-F part=3");

  const piece = (part: number) => bytes.slice(cut[part - 1], cut[part]);

  const early = await send(upload.address, piece(2), { part: 2 });

  expect(early.status).toBe(409);
  expect(early.text).toContain("send part 1 next");

  const unnumbered = await send(upload.address, piece(1));

  expect(unnumbered.status).toBe(400);

  for (const part of [1, 2]) {
    const sent = await send(upload.address, piece(part), { part });

    expect(sent.status, sent.text).toBe(200);
    expect(sent.text).toContain(`Received part ${part} of 3`);
  }

  const halfway = await callText(client, { action: "upload", file_upload: upload.id });

  expect(halfway.isError).toBe(true);
  expect(halfway.text).toContain("2 of 3 part(s)");

  const last = await send(upload.address, piece(3), { part: 3 });

  expect(last.status, last.text).toBe(200);
  expect(last.text).toContain("the whole file");

  const imported = await callText(client, { action: "upload", file_upload: upload.id });

  expect(imported.isError, imported.text).toBe(false);
  expect(await importDone(client, imported.text)).toContain(
    "6 lines read: 6 added, 0 already known (duplicates)",
  );
});

test("the upload address takes a file from a command line only, whole and as declared", async ({
  app,
  user,
  page,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client, person } = await importer(app, user, page, mcpClientId, "lior");
  const { fileName, bytes } = small();
  const upload = await createUpload(client, { file_name: fileName, size: bytes.byteLength });

  // A page of another site posting a form here, or a request carrying the user's session.
  const fromPage = await send(upload.address, bytes, {
    headers: { Origin: "https://elsewhere.example.com" },
  });

  const withSession = await send(upload.address, bytes, {
    headers: {
      Cookie: person.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    },
  });

  for (const refused of [fromPage, withSession]) {
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("never from a browser");
  }

  // An address whose secret is not the one given names nothing.
  const guessed = await send(upload.address.replace(/[\w-]{43}$/, "A".repeat(43)), bytes);

  expect(guessed.status).toBe(404);

  // A file larger, or smaller, than the size declared is never kept.
  const larger = await send(upload.address, new Uint8Array([...bytes, 32]));
  const smaller = await send(upload.address, bytes.slice(1));

  expect(larger.status).toBe(422);
  expect(smaller.status).toBe(422);

  const status = await callText(client, { action: "status", file_upload: upload.id });

  expect(status.text).toContain("pending, 0 of 1 part(s) received (0 of");
});

test("revoking the client deletes its file uploads", async ({ app, user, page, mcpClientId }) => {
  test.setTimeout(90_000);

  const { client, owner } = await importer(app, user, page, mcpClientId, "remi");
  const { fileName, bytes } = small();
  const upload = await createUpload(client, { file_name: fileName, size: bytes.byteLength });

  expect(await uploadsOf(app.database, owner)).toHaveLength(1);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Revoke Gousset end-to-end tests" }).click();

  await expect.poll(async () => (await uploadsOf(app.database, owner)).length).toBe(0);

  const sent = await send(upload.address, bytes);

  expect(sent.status).toBe(404);
});

test("a read-only connection makes no file upload, and is told how to get write", async ({
  app,
  user,
  page,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { client, owner } = await importer(app, user, page, mcpClientId, "ali", allowReadOnly);

  const made = await callText(client, { action: "create_upload", file_name: "a.xml", size: 100 });

  expect(made.isError).toBe(true);
  expect(made.text).toContain("allowed to read only");
  expect(made.text).toContain("Read and write");
  expect(await uploadsOf(app.database, owner)).toEqual([]);
});
