import { Schema } from "effect";
import { strToU8, zipSync } from "fflate";
import type { ZippableFile } from "fflate";

import { IMPORT_FILES_FOLDER } from "./tables";
import type { ExportTable } from "./tables";

// The archive an export gives (#22): one zip of JSON and CSV files and the files imported, with a
// manifest that says what each file holds, readable without Gousset. Pure: the rows come in
// (`./export.ts` reads them), the archive's bytes go out.

/** The manifest's `format`: what kind of archive this is. */
export const EXPORT_FORMAT = "gousset-export";

/**
 * The manifest's `version`. A later version of Gousset adds files and columns without changing it;
 * it changes only when a file or a column it names changes meaning or goes away.
 */
export const EXPORT_VERSION = 1;

export const MANIFEST = "manifest.json";

/** One row as Postgres writes it in JSON: its columns by name, with JSON's own values. */
export type ExportRow = Schema.JsonObject;

/** A table and every row of it. */
export type ExportedTable = {
  readonly table: ExportTable;
  readonly rows: ReadonlyArray<ExportRow>;
};

/** A file as it was imported. */
export type ImportedFile = {
  readonly importId: string;
  readonly fileName: string;
  readonly content: Uint8Array;
};

/** Everything of one user's an export writes. */
export type ExportData = {
  readonly tables: ReadonlyArray<ExportedTable>;
  readonly files: ReadonlyArray<ImportedFile>;
};

/** A file of the archive. */
export type ArchiveFile = { readonly path: string; readonly content: Uint8Array };

/** The archive, ready to download. */
export type ExportArchive = {
  readonly fileName: string;
  readonly content: Uint8Array<ArrayBuffer>;
};

const ABOUT = [
  "Everything you keep in Gousset, as JSON and CSV files any program reads.",
  "Each table comes twice: <name>.json holds its rows as they are, <name>.csv the same rows for a spreadsheet (UTF-8, comma-separated, a header row).",
  "Amounts are whole numbers of minor units of their account's currency: -4217 in euros is -42.17 EUR, 1250 in yen is 1250 JPY.",
  "Days are YYYY-MM-DD; instants are ISO 8601 with their offset. Ids are uuids: a column ending in _id names a row of another file by its id.",
  `Each file you imported is in ${IMPORT_FILES_FOLDER}/<the import's id>/, as you dropped it.`,
  "In the CSV files only, a text that starts with =, +, -, @, a tab or a carriage return is written after a single quote, so that a spreadsheet does not run it as a formula; the JSON files hold it as it is.",
].join(" ");

const isText = Schema.is(Schema.String);

/** A spreadsheet would run a cell that starts so as a formula (OWASP, "CSV injection"). */
const FORMULA_START = /^[=+\-@\t\r]/;

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

function quoted(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One cell of a CSV file (RFC 4180): empty for null, JSON for a nested value. */
export function csvCell(value: Schema.Json | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (isText(value)) {
    return quoted(FORMULA_START.test(value) ? `'${value}` : value);
  }

  return quoted(JSON.stringify(value));
}

/** A table's rows as CSV: the header row, then one row each, every line ended by CRLF. */
export function csvOf(table: ExportTable, rows: ReadonlyArray<ExportRow>): string {
  const names = table.columns.map((column) => column.name);
  const lines = [names.map(quoted).join(",")];

  for (const row of rows) {
    lines.push(names.map((name) => csvCell(row[name])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

/** Names Windows keeps for its devices, whatever their extension (`NUL.txt`). */
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i;

/**
 * A name a file can have in any archive and on any system: no folder, no character a system
 * refuses, no leading dot (so never `.` nor `..`), no trailing dot or space, which Windows drops,
 * and no device name of Windows. The import's folder keeps two files of the same name apart.
 */
export function safeFileName(name: string): string {
  const safe = name
    .replaceAll(/[\p{Cc}/\\:*?"<>|]/gu, "_")
    .slice(0, 120)
    .trim()
    .replace(/^\.+/, "_")
    .replace(/[. ]+$/, "");

  if (safe === "") {
    return "file";
  }

  return WINDOWS_DEVICE.test(safe) ? `_${safe}` : safe;
}

const json = (value: Schema.Json) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

/** The archive's files, the manifest first. */
export function archiveFiles(data: ExportData, exportedAt: Date): ReadonlyArray<ArchiveFile> {
  const files: Array<ArchiveFile> = [];
  const described: Array<Schema.JsonObject> = [];

  for (const { table, rows } of data.tables) {
    const columns = table.columns.map((column) => ({ name: column.name, holds: column.holds }));

    files.push(
      { path: `${table.file}.json`, content: json(rows) },
      { path: `${table.file}.csv`, content: strToU8(csvOf(table, rows)) },
    );
    described.push(
      { path: `${table.file}.json`, holds: table.holds, rows: rows.length, columns },
      {
        path: `${table.file}.csv`,
        holds: `the same rows as ${table.file}.json, for a spreadsheet`,
        rows: rows.length,
      },
    );
  }

  for (const file of data.files) {
    const path = `${IMPORT_FILES_FOLDER}/${file.importId}/${safeFileName(file.fileName)}`;

    files.push({ path, content: file.content });
    described.push({
      path,
      holds: `the file of import ${file.importId} (imports.id), as it was dropped`,
      bytes: file.content.byteLength,
    });
  }

  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: exportedAt.toISOString(),
    about: ABOUT,
    files: described,
  };

  return [{ path: MANIFEST, content: json(manifest) }, ...files];
}

/** `gousset-export-2026-11-23.zip`: the day of the export, in UTC. */
export function archiveName(exportedAt: Date): string {
  return `gousset-export-${exportedAt.toISOString().slice(0, 10)}.zip`;
}

/** The archive: a zip of every file, compressed, each dated the moment of the export. */
export function exportArchive(data: ExportData, exportedAt: Date): ExportArchive {
  const entries = archiveFiles(data, exportedAt).map((file): [string, ZippableFile] => [
    file.path,
    [file.content, { mtime: exportedAt }],
  ]);

  return {
    fileName: archiveName(exportedAt),
    // Its own buffer, as a response's body takes it.
    content: new Uint8Array(zipSync(Object.fromEntries(entries), { level: 6 })),
  };
}
