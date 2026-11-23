import { insertDefaultEntries } from "@gousset/db/entries";
import { category, entry, entryPart } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, exists, notExists, or } from "drizzle-orm";

import { insertDefaultSet } from "./default-categories";
import { classifyByMerchants } from "./merchants/default-classification";

// Every counted line with an amount has exactly one entry (#23; docs/data-model.md, v0.3): an
// expense when money leaves, an income when it comes in, in its kind's fallback category, with one
// payment part of the whole line, `classified_by = default`. Whatever writes lines calls these in
// the transaction that writes them, so that no transaction ever leaves a counted line without its
// entry: the import, as each chunk of lines is saved; undo, for the lines it counts again and the
// entries it leaves with no part. A line of no amount has no entry: there is nothing to classify.
// Nor has a side of a transfer (#26): it is the transfer, never an expense nor an income. Whatever
// pairs lines drops their entries in the transaction that pairs them, and whatever unpairs a line
// gives it its entry back. An entry is an expense or an income only while something pays it (#27):
// one left with refunds alone goes, and the lines of those refunds get their own entry back.

/**
 * Gives an entry to each line among `lineIds` that is `owner`'s, counted, has an amount, no part yet
 * and is no side of a transfer; a line that has one is left as it is, so a second call adds nothing.
 * A user with no category at all gets the English set first. An entry of a merchant with a default
 * category of its kind goes in it, still classified by default.
 */
export async function entriesForLines(
  transaction: UserTransaction,
  owner: string,
  lineIds: ReadonlyArray<string>,
): Promise<void> {
  if (lineIds.length === 0) {
    return;
  }

  const fallbacks = await transaction
    .select({ id: category.id })
    .from(category)
    .where(eq(category.isFallback, true))
    .limit(1);

  if (fallbacks.length === 0) {
    await insertDefaultSet(transaction, owner, "en");
  }

  await insertDefaultEntries(transaction, owner, lineIds);
  await classifyByMerchants(transaction, { lineIds });
}

/**
 * Deletes the user's entries left without a payment: a line's deletion, a pairing or an unlinking
 * took their last one. The lines of the refunds such an entry had left are an expense or an income
 * again on their own: each gets its default entry back, in this same transaction.
 */
export async function dropEntriesWithoutPayments(
  transaction: UserTransaction,
  owner: string,
): Promise<number> {
  const unpaid = notExists(
    transaction
      .select({ id: entryPart.id })
      .from(entryPart)
      .where(and(eq(entryPart.entryId, entry.id), eq(entryPart.role, "payment"))),
  );

  const freed = await transaction
    .select({ lineId: entryPart.lineId })
    .from(entryPart)
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .where(unpaid);

  const dropped = await transaction.delete(entry).where(unpaid).returning({ id: entry.id });

  await entriesForLines(
    transaction,
    owner,
    freed.map((part) => part.lineId),
  );

  return dropped.length;
}

/**
 * Deletes the parts of every line of the user's that is a side of a transfer, then the entries left
 * with no payment: a line just paired stops being an expense or an income.
 */
export async function dropEntriesOfTransferSides(
  transaction: UserTransaction,
  owner: string,
): Promise<void> {
  await transaction.delete(entryPart).where(
    exists(
      transaction
        .select({ id: transfer.id })
        .from(transfer)
        .where(
          or(eq(transfer.outLineId, entryPart.lineId), eq(transfer.inLineId, entryPart.lineId)),
        ),
    ),
  );

  await dropEntriesWithoutPayments(transaction, owner);
}
