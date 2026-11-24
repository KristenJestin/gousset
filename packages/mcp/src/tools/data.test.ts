import {
  DataExport,
  EXPORT_TABLES,
  Expenses,
  FixtureLedger,
  ImportProfiles,
  Imports,
  Merchants,
  RuleJobs,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryLineStore,
} from "@gousset/core";
import type { ExportContents } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { callText, connectInProcess } from "../test-client";
import type { Caller } from "../tool";

const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };

/** What the user's export holds: a row count per table, and the files imported. */
const CONTENTS: ExportContents = {
  tables: EXPORT_TABLES.map((table, index) => ({
    table,
    rows: table.file === "import-profiles" ? 1 : 10 * (index + 1),
  })),
  files: 12,
};

/**
 * The official client connected as a reader, `DataExport` answering `contents` with `contents`;
 * `asked` keeps whose contents were asked for.
 */
async function connect(contents: Effect.Effect<ExportContents> = Effect.succeed(CONTENTS)) {
  const asked: Array<string> = [];

  const exportLayer = Layer.mock(DataExport, {
    contents: (owner) => {
      asked.push(owner);

      return contents;
    },
  });

  const client = await connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              FixtureLedger,
              memoryAccountStore(),
              memoryLineStore(),
              memoryCategoryStore(),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              exportLayer,
              Layer.mock(Merchants, {}),
              Layer.mock(Transfers, {}),
              Layer.mock(Expenses, {}),
              Layer.mock(UserData, {}),
              Layer.mock(RuleJobs, {}),
            ),
          ),
        ),
    },
    reader,
    "2025-11-25",
  );

  return { client, asked };
}

describe("data export", () => {
  test("says what the export holds, file by file, and where the user downloads it", async () => {
    const { client, asked } = await connect();
    const { text, isError } = await callText(client, "data", { action: "export" });

    expect(isError).toBe(false);
    expect(asked).toEqual(["ada"]);
    expect(text).toContain("- accounts.json and accounts.csv: 10 rows, every account you follow");
    expect(text).toContain("- statement-lines.json and statement-lines.csv: 30 rows");
    expect(text).toContain("- import-profiles.json and import-profiles.csv: 1 row,");
    expect(text).toContain("- import-files/: 12 files you imported");
    expect(text).toContain("manifest.json: what each file and column holds");
    expect(text).toContain("Settings, Data (/settings/data)");
  });

  test("is a read: listed read only, idempotent, and given to a read-only connection", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.find((tool) => tool.name === "data")?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test("a failure on Gousset's side says so, never its cause", async () => {
    const { client } = await connect(Effect.die(new Error("57P01: terminating connection")));
    const { text, isError } = await callText(client, "data", { action: "export" });

    expect(isError).toBe(true);
    expect(text).toContain("Gousset could not answer this call");
    expect(text).not.toContain("57P01");
  });

  test("an unknown action is refused with a valid call", async () => {
    const { client } = await connect();
    const { text, isError } = await callText(client, "data", { action: "download" });

    expect(isError).toBe(true);
    expect(text).toContain('data {"action":"export"}');
  });
});
