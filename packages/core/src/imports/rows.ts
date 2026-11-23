import { account, statementImport } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { eq } from "drizzle-orm";

import type { ImportSummary } from "./summary";

// An import's row as the screen and the MCP door read it (`./summary`).

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
