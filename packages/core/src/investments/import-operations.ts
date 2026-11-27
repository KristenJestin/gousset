import { investmentOperation } from "@gousset/db/schema/investments";
import { account, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { eq } from "drizzle-orm";

import { entriesForLines } from "../entries";
import type { CheckedOperation } from "./operation-input";
import { securitiesFor } from "./rows";

// An import of a broker's operations (docs/data-model.md, v0.6), as the import's job saves it: one
// chunk at a time, each in the transaction that saves it, as the statements' import saves its lines
// (`../imports/run.ts`). Each operation is a line of the account, deduplicated by the line's own
// key, and the operation beside it.

/**
 * An operation read from a broker's file, checked (`checkOperation`), with its dedup key, computed
 * over the whole file (`operationDedupKeys`), and the broker's reference for the row when the file
 * gives one, kept as the line's `bank_id` whether or not it is unique.
 */
export type ImportedOperation = CheckedOperation & {
  readonly dedupKey: string;
  readonly reference: string | null;
};

/** What a chunk saved: the operations added, and those the account had already. */
export type SavedOperations = { readonly added: number; readonly duplicate: number };

/**
 * Saves a chunk of an import's operations into the investment account `accountId`, in the import's
 * transaction: their securities found or made by ISIN (named and quoted as the file says, else by
 * the ISIN and in the account's currency), a line for each (`source = import`, its dedup key,
 * `on conflict do nothing`: a line the account has by its key is a duplicate, and its operation is
 * not written again), and an operation for each line actually added. A deposit's and a
 * withdrawal's lines get their default entry, as any imported line gets its own; a purchase's, a
 * sale's, a dividend's and a fee's none. Safe to run again: what an earlier attempt saved is a
 * duplicate. The account is the import's, whose job has checked it is an investment account kept
 * by its lines (`investmentAccountIn`).
 */
export async function saveImportedOperations(
  transaction: UserTransaction,
  owner: string,
  target: { readonly accountId: string; readonly importId: string },
  operations: ReadonlyArray<ImportedOperation>,
): Promise<SavedOperations> {
  if (operations.length === 0) {
    return { added: 0, duplicate: 0 };
  }

  const [into] = await transaction
    .select({ currency: account.currency })
    .from(account)
    .where(eq(account.id, target.accountId));

  if (into === undefined) {
    throw new Error("The import's account is none of the user's.");
  }

  const securities = await securitiesFor(
    transaction,
    owner,
    operations.flatMap((each) => (each.security === null ? [] : [each.security])),
    into.currency,
  );

  const named = (each: ImportedOperation) =>
    each.security === null ? undefined : securities.get(each.security.isin);

  // Oldest first, the order given kept within a day, as the statements' import saves its lines: the
  // file's, or its reverse for a file listed newest first (`../imports/run.ts`).
  const ordered = operations
    .map((each, order) => ({ each, order }))
    .toSorted((a, b) => a.each.bookedOn.localeCompare(b.each.bookedOn) || a.order - b.order)
    .map(({ each }) => each);

  const added = await transaction
    .insert(statementLine)
    .values(
      ordered.map((each) => ({
        userId: owner,
        accountId: target.accountId,
        importId: target.importId,
        source: "import" as const,
        bookedOn: each.bookedOn,
        valueOn: each.valueOn,
        amountMinor: each.amountMinor,
        label: each.label ?? named(each)?.name ?? "",
        bankId: each.reference,
        dedupKey: each.dedupKey,
      })),
    )
    // Another import running at once may have added the same line meanwhile: it is a duplicate.
    .onConflictDoNothing({ target: [statementLine.accountId, statementLine.dedupKey] })
    .returning({ id: statementLine.id, dedupKey: statementLine.dedupKey });

  const byKey = new Map(ordered.map((each) => [each.dedupKey, each]));

  const made = added.flatMap((line) => {
    const each = line.dedupKey === null ? undefined : byKey.get(line.dedupKey);

    return each === undefined
      ? []
      : [
          {
            userId: owner,
            lineId: line.id,
            kind: each.kind,
            securityId: named(each)?.id ?? null,
            quantity: each.quantity,
            unitPrice: each.unitPrice,
            feesMinor: each.feesMinor,
          },
        ];
  });

  if (made.length > 0) {
    await transaction.insert(investmentOperation).values(made);
  }

  // After the operations: the lines of the purchases, sales, dividends and fees get no entry.
  await entriesForLines(
    transaction,
    owner,
    added.map((line) => line.id),
  );

  return { added: added.length, duplicate: operations.length - added.length };
}
