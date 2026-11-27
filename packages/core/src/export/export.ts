import { importFile, merchantLogo, statementImport } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { asc, eq, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import { LogoMediaType } from "../look";
import { exportArchive } from "./archive";
import type { ExportArchive, ExportData, ExportedLogo, ExportedTable } from "./archive";
import { EXPORT_TABLES } from "./tables";
import type { ExportTable } from "./tables";

// Exporting one's data (#22), as the settings page downloads it and the MCP door describes it.
// Every table is read whole by one query, in one snapshot, through `UserData`: row-level security
// keeps the export to the user's own rows (docs/data-model.md, "Ownership and isolation").

/**
 * How many rows each file of an export holds, how many files imported it carries, and how many
 * merchants' logos (#204).
 */
export type ExportContents = {
  readonly tables: ReadonlyArray<{ readonly table: ExportTable; readonly rows: number }>;
  readonly files: number;
  readonly logos: number;
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
 * Every row of the table the transaction sees, in the order rows were made, as Postgres writes
 * them in JSON: every column, a later one included, by its name.
 */
async function rowsOf(transaction: UserTransaction, table: ExportTable): Promise<ExportedTable> {
  const order = sql.join(
    (table.orderedBy ?? ["id"]).map((column) => sql`t.${sql.identifier(column)}`),
    sql`, `,
  );

  const result = await transaction.execute(
    sql`select coalesce(json_agg(t order by ${order}), '[]'::json) as rows from ${sql.identifier(table.table)} t`,
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

  const logoRows = await transaction
    .select({
      merchantId: merchantLogo.merchantId,
      mediaType: merchantLogo.mediaType,
      content: merchantLogo.content,
    })
    .from(merchantLogo)
    .orderBy(asc(merchantLogo.merchantId));

  // The database checks the type is one of the three.
  const logos = logoRows.flatMap((row): ReadonlyArray<ExportedLogo> =>
    isLogoMediaType(row.mediaType)
      ? [{ merchantId: row.merchantId, mediaType: row.mediaType, content: row.content }]
      : [],
  );

  return { tables, files, logos };
}

const isLogoMediaType = Schema.is(LogoMediaType);

async function countAll(transaction: UserTransaction): Promise<ExportContents> {
  const tables: Array<{ table: ExportTable; rows: number }> = [];

  for (const table of EXPORT_TABLES) {
    tables.push({ table, rows: await countOf(transaction, table.table) });
  }

  return {
    tables,
    files: await countOf(transaction, "import_file"),
    logos: await countOf(transaction, "merchant_logo"),
  };
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
