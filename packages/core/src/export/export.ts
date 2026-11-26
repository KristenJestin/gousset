import { importFile, statementImport } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { asc, eq, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import { exportArchive } from "./archive";
import type { ExportArchive, ExportData, ExportedTable } from "./archive";
import { EXPORT_TABLES } from "./tables";
import type { ExportTable } from "./tables";

// Exporting one's data (#22), as the settings page downloads it and the MCP door describes it.
// Every table is read whole by one query, in one snapshot, through `UserData`: row-level security
// keeps the export to the user's own rows (docs/data-model.md, "Ownership and isolation").

/** How many rows each file of an export holds, and how many files imported it carries. */
export type ExportContents = {
  readonly tables: ReadonlyArray<{ readonly table: ExportTable; readonly rows: number }>;
  readonly files: number;
};

/** Exporting the data of the user `owner` of each call. */
export class DataExport extends Context.Service<
  DataExport,
  {
    /** The archive of every row of the user's, and every file they imported, read at once. */
    readonly archive: (owner: string) => Effect.Effect<ExportArchive, QueryFailed>;
    /** What the archive would hold, counted without reading it. */
    readonly contents: (owner: string) => Effect.Effect<ExportContents, QueryFailed>;
  }
>()("@gousset/core/DataExport") {}

const decodeRows = Schema.decodeUnknownSync(
  Schema.Struct({ rows: Schema.Array(Schema.Struct({ rows: Schema.Array(Schema.JsonObject) })) }),
);

const decodeCount = Schema.decodeUnknownSync(
  Schema.Struct({ rows: Schema.Array(Schema.Struct({ count: Schema.Number })) }),
);

/**
 * What a table's rows are read from: the table itself, every column, a later one included; or, for
 * a table with exact decimals (v0.6), its columns as the export describes them, those decimals as
 * their text, which JSON would otherwise give as numbers a reader may round.
 */
function sourceOf(table: ExportTable) {
  if (!table.columns.some((column) => column.exact === true)) {
    return sql`${sql.identifier(table.table)}`;
  }

  const columns = table.columns.map((column) =>
    column.exact === true
      ? sql`${sql.identifier(column.name)}::text as ${sql.identifier(column.name)}`
      : sql.identifier(column.name),
  );

  return sql`(select ${sql.join(columns, sql`, `)} from ${sql.identifier(table.table)})`;
}

/**
 * Every row of the table the transaction sees, in the order rows were made, as Postgres writes
 * them in JSON, by its columns' names.
 */
async function rowsOf(transaction: UserTransaction, table: ExportTable): Promise<ExportedTable> {
  const result = await transaction.execute(
    sql`select coalesce(json_agg(t order by t.id), '[]'::json) as rows from ${sourceOf(table)} t`,
  );

  return { table, rows: decodeRows(result).rows[0]?.rows ?? [] };
}

async function countOf(transaction: UserTransaction, table: string): Promise<number> {
  const result = await transaction.execute(
    sql`select count(*)::int as count from ${sql.identifier(table)}`,
  );

  return decodeCount(result).rows[0]?.count ?? 0;
}

async function readAll(transaction: UserTransaction): Promise<ExportData> {
  const tables: Array<ExportedTable> = [];

  for (const table of EXPORT_TABLES) {
    tables.push(await rowsOf(transaction, table));
  }

  const files = await transaction
    .select({
      importId: importFile.importId,
      fileName: statementImport.fileName,
      content: importFile.content,
    })
    .from(importFile)
    .innerJoin(statementImport, eq(statementImport.id, importFile.importId))
    .orderBy(asc(importFile.importId));

  return { tables, files };
}

async function countAll(transaction: UserTransaction): Promise<ExportContents> {
  const tables: Array<{ table: ExportTable; rows: number }> = [];

  for (const table of EXPORT_TABLES) {
    tables.push({ table, rows: await countOf(transaction, table.table) });
  }

  return { tables, files: await countOf(transaction, "import_file") };
}

/** `DataExport` on the database (`UserData`). */
export const dataExportLayer = Layer.effect(
  DataExport,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      archive: (owner) =>
        Effect.gen(function* () {
          const data = yield* userData.snapshot(owner, readAll);
          const now = yield* Clock.currentTimeMillis;

          return exportArchive(data, new Date(now));
        }),

      contents: (owner) => userData.snapshot(owner, countAll),
    };
  }),
);
