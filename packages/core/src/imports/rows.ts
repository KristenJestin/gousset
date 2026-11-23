import type { importStatus } from "@gousset/db/schema/ledger";
import { account, statementImport } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { eq } from "drizzle-orm";

import type { ImportFormat } from "./keys";

// An import's row as the screen and the MCP door read it.

/** Where an import stands: the values of the database's `import_status`. */
export type ImportStatus = (typeof importStatus.enumValues)[number];

/** The import's steps, in order: the job reports each, and the screen moves through them. */
export const IMPORT_STEPS = ["read", "deduplicate", "save"] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

/** One file dropped, from upload to summary. Days are `YYYY-MM-DD`, instants ISO 8601. */
export type ImportSummary = {
  readonly id: string;
  readonly fileName: string;
  readonly format: ImportFormat;
  readonly status: ImportStatus;
  /** What a waiting import waits for: the user to choose its account, or how to read its CSV. */
  readonly waitingFor: "account" | "profile" | null;
  readonly account: { readonly id: string; readonly name: string } | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly linesRead: number;
  readonly linesAdded: number;
  readonly linesDuplicate: number;
  readonly linesHeld: number;
  /** Why it failed, as a code: a reader's error (`MalformedFile`), `CURRENCY_MISMATCH`… */
  readonly errorCode: string | null;
  /** The job that runs it, for the screen to follow. */
  readonly jobId: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly undoneAt: string | null;
};

/** Gousset's ids are uuids: anything else names no row, rather than a query Postgres refuses. */
export const isId = (id: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);

const summaryColumns = {
  id: statementImport.id,
  fileName: statementImport.fileName,
  format: statementImport.format,
  status: statementImport.status,
  accountId: statementImport.accountId,
  accountName: account.name,
  periodFrom: statementImport.periodFrom,
  periodTo: statementImport.periodTo,
  linesRead: statementImport.linesRead,
  linesAdded: statementImport.linesAdded,
  linesDuplicate: statementImport.linesDuplicate,
  linesHeld: statementImport.linesHeld,
  errorCode: statementImport.errorCode,
  jobId: statementImport.jobId,
  createdAt: statementImport.createdAt,
  finishedAt: statementImport.finishedAt,
  undoneAt: statementImport.undoneAt,
};

/** The imports a query selects, with the name of their account. */
export function selectSummaries(transaction: UserTransaction) {
  return transaction
    .select(summaryColumns)
    .from(statementImport)
    .leftJoin(account, eq(account.id, statementImport.accountId));
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

export function summaryOf(row: SummaryRow): ImportSummary {
  const waiting = row.status === "waiting";

  return {
    id: row.id,
    fileName: row.fileName,
    format: row.format,
    status: row.status,
    waitingFor: waiting ? (row.accountId === null ? "account" : "profile") : null,
    account:
      row.accountId === null || row.accountName === null
        ? null
        : { id: row.accountId, name: row.accountName },
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    linesRead: row.linesRead,
    linesAdded: row.linesAdded,
    linesDuplicate: row.linesDuplicate,
    linesHeld: row.linesHeld,
    errorCode: row.errorCode,
    jobId: row.jobId,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    undoneAt: row.undoneAt?.toISOString() ?? null,
  };
}

/** The import with this id, or `undefined` when the user has none. */
export async function findSummary(
  transaction: UserTransaction,
  importId: string,
): Promise<ImportSummary | undefined> {
  if (!isId(importId)) {
    return undefined;
  }

  const [row] = await selectSummaries(transaction).where(eq(statementImport.id, importId));

  return row === undefined ? undefined : summaryOf(row);
}
