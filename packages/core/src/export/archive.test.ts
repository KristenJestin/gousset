import { madeUpAccounts, madeUpMonth } from "@gousset/fixture";
import { Schema } from "effect";
import fc from "fast-check";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, test } from "vite-plus/test";

import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MANIFEST,
  archiveName,
  csvOf,
  exportArchive,
  safeFileName,
} from "./archive";
import type { ExportData, ExportRow } from "./archive";
import {
  ACCOUNTS,
  ACCOUNT_BALANCES,
  CATEGORIES,
  ENTRIES,
  ENTRY_PARTS,
  ENTRY_SUBJECTS,
  EXPORT_TABLES,
  IMPORTS,
  IMPORT_PROFILES,
  MERCHANTS,
  MERCHANT_ALIASES,
  RULES,
  STATEMENT_LINES,
  SUBJECTS,
  SUBJECT_ACCOUNTS,
  SUBJECT_ENTRIES_REFUSED,
  TRANSFERS,
} from "./tables";
import type { ExportTable } from "./tables";

const OWNER = "made-up-user";
const EXPORTED_AT = new Date("2026-11-23T09:30:00.000Z");
const MONTHS = ["2026-09", "2026-10"];

let made = 0;

/** A uuid of the made-up data, in the order rows are made, as `uuidv7()` orders them. */
function nextId(): string {
  made += 1;

  return `00000000-0000-7000-8000-${made.toString(16).padStart(12, "0")}`;
}

/** A row with every column of its table, those not given empty, as Postgres writes them. */
function row(table: ExportTable, values: ExportRow): ExportRow {
  return Object.fromEntries(
    table.columns.map((column) => [column.name, values[column.name] ?? null]),
  );
}

/** The shared made-up data of two months, as rows of a user's tables, as the seed writes it. */
function madeUpExport(): ExportData {
  const accounts: Array<ExportRow> = [];
  const imports: Array<ExportRow> = [];
  const lines: Array<ExportRow> = [];
  const balances: Array<ExportRow> = [];
  const transfers: Array<ExportRow> = [];
  const files: Array<ExportData["files"][number]> = [];
  const accountIds = new Map<string, string>();
  const lineIds = new Map<string, string>();
  const entries: Array<ExportRow> = [];
  const parts: Array<ExportRow> = [];

  // Each kind's fallback, where the import puts every line's entry.
  const categories = (["expense", "income"] as const).map((kind, position) =>
    row(CATEGORIES, {
      id: nextId(),
      user_id: OWNER,
      kind,
      name: "Other",
      position,
      benchmark_mode: "automatic",
      is_fallback: true,
      created_at: "2026-09-01T08:00:00+00:00",
      updated_at: "2026-09-01T08:00:00+00:00",
    }),
  );

  const [expenseFallback, incomeFallback] = categories;

  for (const account of madeUpAccounts) {
    const id = nextId();

    accountIds.set(account.id, id);
    accounts.push(
      row(ACCOUNTS, {
        id,
        user_id: OWNER,
        name: account.name,
        kind: account.kind,
        institution: account.bank,
        currency: account.currency,
        mode: "lines",
        opening_balance_minor: 0,
        credit_order: "oldest_first",
        created_at: "2026-09-01T08:00:00+00:00",
        updated_at: "2026-09-01T08:00:00+00:00",
      }),
    );
  }

  for (const month of MONTHS) {
    for (const account of madeUpAccounts) {
      const ofAccount = madeUpMonth(month).lines.filter((line) => line.accountId === account.id);
      const accountId = accountIds.get(account.id) ?? null;

      if (ofAccount.length === 0) {
        continue;
      }

      const importId = nextId();
      const fileName = `${account.id}-${month}.ofx`;

      imports.push(
        row(IMPORTS, {
          id: importId,
          user_id: OWNER,
          account_id: accountId,
          file_name: fileName,
          file_sha256: "0".repeat(64),
          format: "ofx",
          status: "done",
          period_from: `${month}-01`,
          lines_read: ofAccount.length,
          lines_added: ofAccount.length,
          lines_duplicate: 0,
          lines_held: 0,
          created_at: `${month}-28T10:00:00+00:00`,
        }),
      );
      files.push({ importId, fileName, content: strToU8(`OFXHEADER:100 ${account.id} ${month}`) });

      for (const line of ofAccount) {
        const lineId = nextId();
        const fallback = line.amountMinor < 0 ? expenseFallback : incomeFallback;

        lineIds.set(line.id, lineId);

        // A side of a transfer has no entry: it is the transfer.
        if (line.counterpartLineId === null) {
          const entryId = nextId();

          entries.push(
            row(ENTRIES, {
              id: entryId,
              user_id: OWNER,
              kind: line.amountMinor < 0 ? "expense" : "income",
              happened_on: line.bookedOn,
              category_id: fallback?.["id"] ?? null,
              classified_by: "default",
              created_at: `${month}-28T10:00:00+00:00`,
              updated_at: `${month}-28T10:00:00+00:00`,
            }),
          );
          parts.push(
            row(ENTRY_PARTS, {
              id: nextId(),
              user_id: OWNER,
              entry_id: entryId,
              line_id: lineId,
              role: "payment",
              amount_minor: Math.abs(line.amountMinor),
            }),
          );
        }

        lines.push(
          row(STATEMENT_LINES, {
            id: lineId,
            user_id: OWNER,
            account_id: accountId,
            import_id: importId,
            source: "import",
            state: "counted",
            booked_on: line.bookedOn,
            amount_minor: line.amountMinor,
            label: line.label,
            bank_id: line.id,
            dedup_key: `bank:${line.id}`,
          }),
        );
      }

      balances.push(
        row(ACCOUNT_BALANCES, {
          id: nextId(),
          user_id: OWNER,
          account_id: accountId,
          day: `${month}-28`,
          balance_minor: 1234,
          source: "statement",
          import_id: importId,
        }),
      );
    }
  }

  // The made-up transfers, paired as the import pairs them.
  for (const month of MONTHS) {
    for (const line of madeUpMonth(month).lines) {
      const other = line.counterpartLineId;

      if (line.amountMinor < 0 && other !== null) {
        transfers.push(
          row(TRANSFERS, {
            id: nextId(),
            user_id: OWNER,
            out_line_id: lineIds.get(line.id) ?? null,
            in_line_id: lineIds.get(other) ?? null,
            paired_by: "import",
          }),
        );
      }
    }
  }

  const profiles = [
    row(IMPORT_PROFILES, {
      id: nextId(),
      user_id: OWNER,
      name: "Riverside Bank CSV",
      institution: "Riverside Bank",
      kind: "statement",
      definition: { version: 1, separator: ";", columns: { date: 0, label: 1, amount: 2 } },
      header: "date;label;amount",
    }),
  ];

  const merchantId = nextId();

  const merchants = [
    row(MERCHANTS, {
      id: merchantId,
      user_id: OWNER,
      name: "Greenmarket",
      created_at: "2026-09-28T10:00:00+00:00",
      updated_at: "2026-09-28T10:00:00+00:00",
    }),
  ];

  const aliases = [
    row(MERCHANT_ALIASES, {
      id: nextId(),
      user_id: OWNER,
      merchant_id: merchantId,
      alias: "GREENMARKET",
      created_at: "2026-09-28T10:00:00+00:00",
    }),
  ];

  const rules = [
    row(RULES, {
      id: nextId(),
      user_id: OWNER,
      position: 1,
      enabled: true,
      conditions: {
        kind: "group",
        combinator: "and",
        children: [{ kind: "rule", field: "label", operator: "contains", value: "GREENMARKET" }],
      },
      set_merchant_id: merchantId,
      set_category_id: null,
      applied_count: 12,
      created_from: "correction",
      created_at: "2026-10-02T10:00:00+00:00",
      updated_at: "2026-10-02T10:00:00+00:00",
    }),
  ];

  // The van (#37), linked to the first account, one expense attached and another refused.
  const vanId = nextId();
  const [attached, refused] = entries;

  const subjects = [
    row(SUBJECTS, {
      id: vanId,
      user_id: OWNER,
      name: "Van",
      estimated_value_minor: 1_800_000,
      value_currency: "EUR",
      starts_on: "2026-09-01",
      created_at: "2026-10-02T10:00:00+00:00",
      updated_at: "2026-10-02T10:00:00+00:00",
    }),
  ];

  const entrySubjects = [
    row(ENTRY_SUBJECTS, { entry_id: attached?.id ?? null, subject_id: vanId, user_id: OWNER }),
  ];

  const subjectAccounts = [
    row(SUBJECT_ACCOUNTS, {
      subject_id: vanId,
      account_id: accounts[0]?.id ?? null,
      user_id: OWNER,
    }),
  ];

  const refusals = [
    row(SUBJECT_ENTRIES_REFUSED, {
      subject_id: vanId,
      entry_id: refused?.id ?? null,
      user_id: OWNER,
    }),
  ];

  const byTable = new Map<ExportTable, ReadonlyArray<ExportRow>>([
    [ACCOUNTS, accounts],
    [ACCOUNT_BALANCES, balances],
    [STATEMENT_LINES, lines],
    [IMPORTS, imports],
    [IMPORT_PROFILES, profiles],
    [CATEGORIES, categories],
    [ENTRIES, entries],
    [ENTRY_PARTS, parts],
    [TRANSFERS, transfers],
    [MERCHANTS, merchants],
    [MERCHANT_ALIASES, aliases],
    [RULES, rules],
    [SUBJECTS, subjects],
    [ENTRY_SUBJECTS, entrySubjects],
    [SUBJECT_ACCOUNTS, subjectAccounts],
    [SUBJECT_ENTRIES_REFUSED, refusals],
  ]);

  return {
    tables: EXPORT_TABLES.map((table) => ({ table, rows: byTable.get(table) ?? [] })),
    files,
  };
}

/** RFC 4180, as a spreadsheet reads it: quoted cells may hold commas, quotes and line breaks. */
function parseCsv(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let cells: Array<string> = [];
  let cell = "";
  let inQuotes = false;

  for (let at = 0; at < text.length; at += 1) {
    const character = text.charAt(at);

    if (inQuotes) {
      if (character === '"' && text.charAt(at + 1) === '"') {
        cell += '"';
        at += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      cells.push(cell);
      cell = "";
    } else if (character === "\r" && text.charAt(at + 1) === "\n") {
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = "";
      at += 1;
    } else {
      cell += character;
    }
  }

  return rows;
}

const Rows = Schema.Array(Schema.JsonObject);

const Manifest = Schema.Struct({
  format: Schema.String,
  version: Schema.Number,
  exported_at: Schema.String,
  about: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      holds: Schema.String,
      rows: Schema.optional(Schema.Number),
      bytes: Schema.optional(Schema.Number),
      columns: Schema.optional(
        Schema.Array(Schema.Struct({ name: Schema.String, holds: Schema.String })),
      ),
    }),
  ),
});

function unzipped(data: ExportData) {
  const archive = exportArchive(data, EXPORTED_AT);
  const files = unzipSync(archive.content);

  const text = (path: string) => {
    const content = files[path];

    if (content === undefined) {
      throw new Error(`The archive has no ${path}.`);
    }

    return strFromU8(content);
  };

  return {
    archive,
    files,
    text,
    json: (path: string) => Schema.decodeUnknownSync(Rows)(JSON.parse(text(path))),
    manifest: () => Schema.decodeUnknownSync(Manifest)(JSON.parse(text(MANIFEST))),
  };
}

describe("the export's archive", () => {
  const data = madeUpExport();
  const read = unzipped(data);

  test("an export of the made-up data holds every row, in its JSON file as it is", () => {
    const lines = data.tables.find((each) => each.table === STATEMENT_LINES);

    // The made-up data has rows in every table, two months of lines among them.
    expect(lines?.rows.length).toBeGreaterThan(50);

    for (const { table, rows } of data.tables) {
      expect(rows.length, table.file).toBeGreaterThan(0);
      expect(read.json(`${table.file}.json`), table.file).toEqual(rows);
    }
  });

  test("and every row in its CSV file, every column in the manifest's order", () => {
    for (const { table, rows } of data.tables) {
      const [header, ...body] = parseCsv(read.text(`${table.file}.csv`));
      const names = table.columns.map((column) => column.name);

      expect(header, table.file).toEqual(names);
      // The first column names the row: its id, or for a table of links (#37) the row it links.
      const first = names[0] ?? "id";

      expect(
        body.map((cells) => cells[0]),
        table.file,
      ).toEqual(rows.map((each) => each[first]));

      for (const [index, cells] of body.entries()) {
        const source = rows[index];

        for (const [at, name] of names.entries()) {
          const value = source?.[name];

          const expected =
            value === null || value === undefined
              ? ""
              : Schema.is(Schema.String)(value)
                ? value
                : JSON.stringify(value);

          expect(cells[at], `${table.file} ${name}`).toBe(expected);
        }
      }
    }
  });

  test("every file imported is in the archive, byte for byte, in its import's folder", () => {
    expect(data.files.length).toBeGreaterThan(0);

    for (const file of data.files) {
      expect(read.files[`import-files/${file.importId}/${file.fileName}`]).toEqual(file.content);
    }
  });

  test("the manifest says the format's version and what each file of the archive holds", () => {
    const manifest = read.manifest();
    const listed = manifest.files.map((file) => file.path);

    expect(manifest.format).toBe(EXPORT_FORMAT);
    expect(manifest.version).toBe(EXPORT_VERSION);
    expect(manifest.exported_at).toBe("2026-11-23T09:30:00.000Z");
    expect(manifest.about).toContain("minor units");
    expect(Object.keys(read.files).toSorted()).toEqual([MANIFEST, ...listed].toSorted());

    for (const { table, rows } of data.tables) {
      const json = manifest.files.find((file) => file.path === `${table.file}.json`);
      const csv = manifest.files.find((file) => file.path === `${table.file}.csv`);

      expect(json?.rows).toBe(rows.length);
      expect(csv?.rows).toBe(rows.length);
      expect(json?.columns?.map((column) => column.name)).toEqual(
        table.columns.map((column) => column.name),
      );
      expect(json?.columns?.every((column) => column.holds !== "")).toBe(true);
    }

    for (const file of data.files) {
      const entry = manifest.files.find((each) =>
        each.path.startsWith(`import-files/${file.importId}/`),
      );

      expect(entry?.bytes).toBe(file.content.byteLength);
      expect(entry?.holds).toContain(file.importId);
    }
  });

  test("is named after the day it was made", () => {
    expect(read.archive.fileName).toBe("gousset-export-2026-11-23.zip");
    expect(archiveName(new Date("2027-01-02T23:59:00Z"))).toBe("gousset-export-2027-01-02.zip");
  });
});

describe("the export's CSV", () => {
  const table: ExportTable = {
    table: "example",
    file: "example",
    holds: "texts",
    columns: [
      { name: "id", holds: "an id" },
      { name: "text", holds: "any text" },
    ],
  };

  const csvRows = (rows: ReadonlyArray<ExportRow>) => parseCsv(csvOf(table, rows)).slice(1);

  test("a text a spreadsheet would run as a formula is written after a single quote", () => {
    const formulas = ['=HYPERLINK("http://example.com")', "+1+1", "-2+3", "@SUM(A1)", "\tTAB"];

    expect(csvRows(formulas.map((text, id) => ({ id, text }))).map((cells) => cells[1])).toEqual(
      formulas.map((text) => `'${text}`),
    );

    // A number is no text: a negative amount stays a number.
    expect(csvRows([{ id: 1, text: -4217 }])).toEqual([["1", "-4217"]]);
  });

  test("any other text reads back as it was: commas, quotes, line breaks, accents", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: "binary" }).filter((text) => !/^[=+\-@\t\r]/.test(text))),
        (texts) => {
          const rows = texts.map((text, id): ExportRow => ({ id, text }));

          expect(csvRows(rows)).toEqual(texts.map((text, id) => [String(id), text]));
        },
      ),
    );
  });

  test("a nested value is written as JSON, and an empty one as nothing", () => {
    expect(
      csvRows([
        { id: 1, text: { version: 1, columns: [0, 1] } },
        { id: 2, text: null },
      ]),
    ).toEqual([
      ["1", '{"version":1,"columns":[0,1]}'],
      ["2", ""],
    ]);
  });
});

describe("a file imported", () => {
  test("keeps its name, and can name no folder nor hide itself", () => {
    expect(safeFileName("statement-2026-10.ofx")).toBe("statement-2026-10.ofx");
    expect(safeFileName("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(safeFileName(String.raw`C:\exports\october.csv`)).toBe("C__exports_october.csv");
    expect(safeFileName(".hidden")).toBe("_hidden");
    expect(safeFileName("")).toBe("file");

    // Spaces first never shield a dot: no `.`, `..` nor hidden file once unzipped.
    for (const name of [".", "..", " ..", " . ", "   "]) {
      expect(safeFileName(name), JSON.stringify(name)).not.toMatch(/^\.|^\s|^$/);
    }

    expect(safeFileName(" .hidden")).toBe("_hidden");
  });

  test("is a name Windows extracts as it is", () => {
    expect(safeFileName("october.ofx. ")).toBe("october.ofx");
    expect(safeFileName("NUL.txt")).toBe("_NUL.txt");
    expect(safeFileName("com1")).toBe("_com1");
    expect(safeFileName("console.csv")).toBe("console.csv");
  });

  test("two files of the same name stay apart, each in its import's folder", () => {
    const content = strToU8("same name");

    const data: ExportData = {
      tables: [],
      files: [
        { importId: "00000000-0000-7000-8000-0000000000a1", fileName: "october.ofx", content },
        { importId: "00000000-0000-7000-8000-0000000000a2", fileName: "october.ofx", content },
      ],
    };

    expect(Object.keys(unzipped(data).files).toSorted()).toEqual([
      "import-files/00000000-0000-7000-8000-0000000000a1/october.ofx",
      "import-files/00000000-0000-7000-8000-0000000000a2/october.ofx",
      MANIFEST,
    ]);
  });
});
