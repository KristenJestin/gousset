import {
  DataExport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  IMPORT_FILES_FOLDER,
  MANIFEST,
  MERCHANT_LOGOS_FOLDER,
} from "@gousset/core";
import type { ExportContents } from "@gousset/core";
import { Effect, Schema } from "effect";

import { defineTool } from "../tool";

/** Where the user downloads the export, in the app: Settings, Data. */
export const EXPORT_PAGE = "/settings/data";

const DataInput = Schema.Struct({
  action: Schema.Literals(["export"]).annotate({
    description: "export: what an export of all the user's data holds, and where they download it.",
  }),
});

type DataInput = typeof DataInput.Type;

const DESCRIPTION = `Says what an export of all the user's Gousset data holds, and where the user downloads it. Use it when the user asks to export, download, back up or take away their data, or what Gousset keeps of theirs.

Actions:
- export (reads): counts what the export holds (accounts, statement lines, balances, imports, CSV profiles, the files imported and the merchants' logos) and gives the page where the user downloads it, signed in to Gousset in a browser: Settings, Data (${EXPORT_PAGE}). The archive is a zip of JSON and CSV files, readable without Gousset, with a manifest saying what each file holds.

The archive itself never comes through MCP: it holds every row and every file the user imported, to be saved by them, not read in a conversation. To read the data, use the other tools. A backup of the whole installation is the administrator's, outside Gousset.

Example:
{"action":"export"}`;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function contentsText(contents: ExportContents): string {
  return [
    "An export of your Gousset data holds:",
    ...contents.tables.map(
      ({ table, rows }) =>
        `- ${table.file}.json and ${table.file}.csv: ${plural(rows, "row", "rows")}, ${table.holds}.`,
    ),
    `- ${IMPORT_FILES_FOLDER}/: ${plural(contents.files, "file", "files")} you imported, as you dropped them.`,
    `- ${MERCHANT_LOGOS_FOLDER}/: ${plural(contents.logos, "logo", "logos")} you uploaded for your merchants, as you uploaded them.`,
    `- ${MANIFEST}: what each file and column holds (format ${EXPORT_FORMAT}, version ${EXPORT_VERSION}).`,
    `To download it, open Gousset in a browser, signed in, and go to Settings, Data (${EXPORT_PAGE}): Download the export. It is made when downloaded, so it holds what is there at that moment.`,
  ].join("\n");
}

export const dataTool = defineTool<DataInput, typeof DataInput.Encoded, DataExport>({
  name: "data",
  title: "Your data",
  description: DESCRIPTION,
  idempotent: true,
  input: DataInput,
  example: { action: "export" },
  access: { export: "read" },
  run: (_input, caller) =>
    Effect.gen(function* () {
      const data = yield* DataExport;

      return contentsText(yield* data.contents(caller.userId));
    }).pipe(
      // A failed read is Gousset's own failure: the door answers it as such, never with its cause.
      Effect.orDie,
    ),
});
