import { importFile, lineAttachment, statementImport } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { asc, eq, sql } from "drizzle-orm";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import type { ReceiptStorageFailed } from "../attachments/errors";
import { ReceiptStorage } from "../attachments/storage";
import { exportArchiveStream } from "./archive";
import type { ExportData, ExportStream, ExportedReceipt, ExportedTable } from "./archive";
import { EXPORT_TABLES } from "./tables";
import type { ExportTable } from "./tables";

// Exporting one's data (#22), as the settings page downloads it and the MCP door describes it.
// Every table is read whole by one query, in one snapshot, through `UserData`: row-level security
// keeps the export to the user's own rows (docs/data-model.md, "Ownership and isolation"). The
// receipts' files (#217) are on disk, read from the user's folder as the archive is downloaded.

/** How many rows each file of an export holds, and how many files imported and receipts it carries. */
export type ExportContents = {
  readonly tables: ReadonlyArray<{ readonly table: ExportTable; readonly rows: number }>;
  readonly files: number;
  readonly receipts: number;
};

/** Exporting the data of the user `owner` of each call. */
export class DataExport extends Context.Service<
  DataExport,
  {
    /**
     * The archive of every row of the user's, every file they imported and every receipt they
     * attached, the rows read at once, the receipts' files as it is downloaded.
     */
    readonly archive: (
      owner: string,
    ) => Effect.Effect<ExportStream, QueryFailed | ReceiptStorageFailed>;
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

async function readAll(transaction: UserTransaction) {
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

  const receipts = await transaction
    .select({
      receiptId: lineAttachment.id,
      fileName: lineAttachment.fileName,
      bytes: lineAttachment.size,
      storedName: lineAttachment.storedName,
    })
    .from(lineAttachment)
    .orderBy(asc(lineAttachment.id));

  return { data: { tables, files } satisfies ExportData, receipts };
}

async function countAll(transaction: UserTransaction): Promise<ExportContents> {
  const tables: Array<{ table: ExportTable; rows: number }> = [];

  for (const table of EXPORT_TABLES) {
    tables.push({ table, rows: await countOf(transaction, table.table) });
  }

  return {
    tables,
    files: await countOf(transaction, "import_file"),
    receipts: await countOf(transaction, "line_attachment"),
  };
}

/** `DataExport` on the database (`UserData`) and the receipts' directory (`ReceiptStorage`). */
export const dataExportLayer = Layer.effect(
  DataExport,
  Effect.gen(function* () {
    const userData = yield* UserData;
    const storage = yield* ReceiptStorage;

    return {
      archive: (owner) =>
        Effect.gen(function* () {
          const { data, receipts } = yield* userData.snapshot(owner, readAll);
          const onDisk = new Set((yield* storage.list(owner)).map((file) => file.name));
          const now = yield* Clock.currentTimeMillis;

          // A receipt whose file is no longer on disk keeps its row in line-attachments, alone.
          const exported = receipts.flatMap((receipt): Array<ExportedReceipt> =>
            onDisk.has(receipt.storedName)
              ? [
                  {
                    receiptId: receipt.receiptId,
                    fileName: receipt.fileName,
                    bytes: receipt.bytes,
                    open: () => Effect.runPromise(storage.open(owner, receipt.storedName)),
                  },
                ]
              : [],
          );

          return exportArchiveStream(data, exported, new Date(now));
        }),

      contents: (owner) => userData.snapshot(owner, countAll),
    };
  }),
);
