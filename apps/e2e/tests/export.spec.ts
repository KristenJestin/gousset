import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Client } from "@modelcontextprotocol/client";
import { request } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EXPORT_FORMAT, EXPORT_TABLES, EXPORT_VERSION } from "@gousset/core";
import { Schema } from "effect";

import { addUser, createUser, signIn } from "../src/auth";
import type { TestUser } from "../src/auth";
import { readArchive } from "../src/export";
import { connectMcp, expect, test, visit } from "../src/test";
import { NOT_EXPORTED, USER_TABLES, keysOf, openUserData } from "../src/user-data";

/** The user tables an export carries, as rows or as files. */
const EXPORTED = USER_TABLES.filter((table) => !NOT_EXPORTED.has(table.name));

// Issue #22, exporting one's data: from Settings, Data, a user downloads one archive of every row
// of theirs as JSON and CSV, and every file they imported, with a manifest; the MCP door's `data`
// tool says what it holds and where to download it. Each test has a user of its own, seeded with
// the made-up data, so that no other test's rows meet theirs.

/** A user of the test's own, holding the made-up data of two months. */
async function personWithData(
  app: { baseURL: string; database: string; slot: number },
  admin: TestUser,
  local: string,
): Promise<{ person: TestUser; owner: string }> {
  const person = await addUser(app.baseURL, admin, {
    name: "Kim Example",
    email: `kim.${local}.worker${app.slot}@example.com`,
    password: `e2e-kim-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);
    const seeded = await data.seed(owner);

    expect(seeded.lines).toBeGreaterThan(0);

    return { person, owner };
  } finally {
    await data.close();
  }
}

const Imports = Schema.Array(Schema.Struct({ id: Schema.String, file_sha256: Schema.String }));

/** An operation's exact decimals: text, or nothing for a kind that has none. */
const Operations = Schema.Array(
  Schema.Struct({
    kind: Schema.String,
    quantity: Schema.NullOr(Schema.String),
    unit_price: Schema.NullOr(Schema.String),
  }),
);

test("an export of the made-up data holds every row", async ({ app, user, page }) => {
  test.setTimeout(90_000);

  const { person, owner } = await personWithData(app, user, "download");

  await page.context().addCookies([...person.cookies]);
  await visit(page, "/settings/data");

  const downloading = page.waitForEvent("download");

  await page.getByRole("link", { name: "Download the export" }).click();

  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/^gousset-export-\d{4}-\d{2}-\d{2}\.zip$/);

  const archive = readArchive(new Uint8Array(await readFile(await download.path())));

  expect(archive.manifest.format).toBe(EXPORT_FORMAT);
  expect(archive.manifest.version).toBe(EXPORT_VERSION);

  const data = openUserData(app.database);

  try {
    for (const table of EXPORTED) {
      // Every row the user has, as their own transaction sees it.
      const keys = await data.asUser(owner, (transaction) => keysOf(transaction, table));

      expect(keys.length, table.name).toBeGreaterThan(0);

      if (table.name === "import_file") {
        const folders = Object.keys(archive.files).flatMap((path) =>
          path.startsWith("import-files/") ? [path.split("/")[1] ?? ""] : [],
        );

        expect(folders.toSorted(), table.name).toEqual([...keys].toSorted());

        continue;
      }

      const exported = EXPORT_TABLES.find((each) => each.table === table.name);

      expect(exported, `${table.name} is exported`).toBeDefined();

      const file = exported?.file ?? table.name;
      const rows = archive.rows(file);

      expect(rows.map((row) => row.id).toSorted(), table.name).toEqual([...keys].toSorted());
      expect(new Set(rows.map((row) => row.user_id)), table.name).toEqual(new Set([owner]));
      expect(
        archive.manifest.files.find((each) => each.path === `${file}.json`)?.rows,
        table.name,
      ).toBe(keys.length);
      // The CSV file: a header, then one line per row (no made-up label holds a line break).
      expect(archive.text(`${file}.csv`).trimEnd().split("\r\n"), table.name).toHaveLength(
        keys.length + 1,
      );
    }
  } finally {
    await data.close();
  }

  // A quantity and a unit price are exact decimals (v0.6): written as their text, never as a JSON
  // number a reader would round.
  const operations = Schema.decodeUnknownSync(Operations)(
    JSON.parse(archive.text("investment-operations.json")),
  );

  const bought = operations.filter((row) => row.kind === "purchase");

  expect(bought.length).toBeGreaterThan(0);

  for (const row of bought) {
    expect(row.quantity).toMatch(/^\d+\.\d+$/);
    expect(row.unit_price).toMatch(/^\d+\.\d+$/);
  }

  // Each file imported comes back byte for byte: its SHA-256 is the one its import recorded.
  const imports = Schema.decodeUnknownSync(Imports)(JSON.parse(archive.text("imports.json")));

  for (const imported of imports) {
    const [path] = Object.keys(archive.files).filter((each) =>
      each.startsWith(`import-files/${imported.id}/`),
    );

    const content = archive.files[path ?? ""] ?? new Uint8Array();

    expect(createHash("sha256").update(content).digest("hex"), path).toBe(imported.file_sha256);
  }
});

test("every column of every user table is described in the export's manifest", async ({ app }) => {
  const data = openUserData(app.database);

  try {
    // Every table holding a user's rows is exported, but those NOT_EXPORTED says; the imported
    // files go as files.
    expect(EXPORT_TABLES.map((table) => table.table).toSorted()).toEqual(
      EXPORTED.flatMap((table) => (table.name === "import_file" ? [] : [table.name])).toSorted(),
    );

    for (const table of EXPORT_TABLES) {
      expect(
        table.columns.map((column) => column.name),
        table.table,
      ).toEqual(await data.columnsOf(table.table));
    }
  } finally {
    await data.close();
  }
});

test("the export needs a session", async ({ playwright, app }) => {
  const anonymous = await playwright.request.newContext({ baseURL: app.baseURL });

  try {
    const answer = await anonymous.get("/api/export");

    expect(answer.status()).toBe(401);
    expect(answer.headers()["content-type"]).toContain("application/json");
  } finally {
    await anonymous.dispose();
  }
});

test("a temporary password exports nothing until it is changed", async ({ app, user }) => {
  const person = {
    name: "Lou Example",
    email: `lou.export.worker${app.slot}@example.com`,
    password: `e2e-lou-temporary-${app.slot}`,
  };

  // Created by the administrator, as the users page does: the password is theirs, not Lou's.
  await createUser(app.baseURL, user, person);

  const held = await signIn(app.baseURL, { ...person, cookies: [] });

  const context = await request.newContext({
    baseURL: app.baseURL,
    storageState: { cookies: [...held.cookies], origins: [] },
  });

  try {
    const answer = await context.get("/api/export");

    expect(answer.status()).toBe(403);
    expect(await answer.json()).toEqual({ refused: "PASSWORD_CHANGE_REQUIRED" });
  } finally {
    await context.dispose();
  }
});

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: { [key: string]: string }) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

test("an MCP client with read access learns what the export holds and where to get it", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}) => {
  test.setTimeout(90_000);

  const { person, owner } = await personWithData(app, user, "mcp");

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadOnly,
    scope: "read",
    clientId: mcpClientId,
  });

  const answer = await callText(session.client, "data", { action: "export" });

  expect(answer.isError, answer.text).toBe(false);

  const data = openUserData(app.database);

  try {
    for (const table of EXPORTED) {
      const count = (await data.asUser(owner, (transaction) => keysOf(transaction, table))).length;
      const exported = EXPORT_TABLES.find((each) => each.table === table.name);

      expect(answer.text).toContain(
        exported === undefined
          ? `- import-files/: ${count} files you imported`
          : `- ${exported.file}.json and ${exported.file}.csv: ${count} row${count === 1 ? "" : "s"}, `,
      );
    }
  } finally {
    await data.close();
  }

  expect(answer.text).toContain("Settings, Data (/settings/data)");
});
