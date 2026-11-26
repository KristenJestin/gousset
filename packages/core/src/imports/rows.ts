import { investmentOperation } from "@gousset/db/schema/investments";
import { account, importProfile, statementImport, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { SHIPPED_PROFILES } from "@gousset/import";
import { eq, sql } from "drizzle-orm";

import type { ImportSummary } from "./summary";

// An import's row as the screen and the MCP door read it (`./summary`).

/** Gousset's ids are uuids: anything else names no row, rather than a query Postgres refuses. */
export const isId = (id: string) =>
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);

/** Each shipped profile's name, by its key. */
const SHIPPED_NAMES: ReadonlyMap<string, string> = new Map(
  SHIPPED_PROFILES.map((each) => [each.key, each.name]),
);

/**
 * Whether the import reads a broker's operations (v0.6): its profile, the user's, is of the kind
 * `operations` (none is shipped), or its lines are operations' cash (a definition given by hand,
 * which the import does not record).
 */
const readsOperations =
  sql<boolean>`(${importProfile.kind} = 'operations' or exists (select 1 from ${statementLine} inner join ${investmentOperation} on ${investmentOperation.lineId} = ${statementLine.id} where ${statementLine.importId} = ${statementImport.id}))`.mapWith(
    Boolean,
  );

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
  readsOperations,
  profileName: importProfile.name,
  shippedProfile: statementImport.shippedProfile,
  balanceIgnored: statementImport.balanceIgnored,
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
    .leftJoin(account, eq(account.id, statementImport.accountId))
    .leftJoin(importProfile, eq(importProfile.id, statementImport.profileId));
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
    reads: row.readsOperations ? "operations" : "statement",
    profile:
      row.profileName ??
      (row.shippedProfile === null ? null : (SHIPPED_NAMES.get(row.shippedProfile) ?? null)),
    balanceIgnored: row.balanceIgnored,
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
