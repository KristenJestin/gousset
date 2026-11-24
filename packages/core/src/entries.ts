import { insertDefaultEntries } from "@gousset/db/entries";
import { category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, exists, inArray, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

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

/** A payment that left an entry: the entry, and the day its line was booked. */
export type PaymentGone = { readonly entryId: string; readonly bookedOn: string };

/** The payments the lines `lines` selects make, read before they leave their entries. */
export function paymentsOfLines(
  transaction: UserTransaction,
  lines: SQL,
): Promise<ReadonlyArray<PaymentGone>> {
  return transaction
    .select({ entryId: entryPart.entryId, bookedOn: statementLine.bookedOn })
    .from(entryPart)
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(and(lines, eq(entryPart.role, "payment")));
}

/**
 * An entry happened on its first payment's day (docs/data-model.md, `entry.happened_on`): when the
 * payment that day came from leaves, the day moves to the next payment's. A day that no payment
 * that left gave is the user's, or its first payment's still, and stays.
 */
async function followFirstPayments(
  transaction: UserTransaction,
  gone: ReadonlyArray<PaymentGone>,
): Promise<void> {
  if (gone.length === 0) {
    return;
  }

  const entryIds = [...new Set(gone.map((each) => each.entryId))];

  // Two reads for every entry a change touched (an undone import touches many), the ids as one
  // array parameter (uuids hold no comma): their days, and their first payment's day.
  const among = sql`any(string_to_array(${entryIds.join(",")}, ',')::uuid[])`;

  const left = await transaction
    .select({ id: entry.id, happenedOn: entry.happenedOn })
    .from(entry)
    .where(sql`${entry.id} = ${among}`);

  const firsts = await transaction
    .select({
      entryId: entryPart.entryId,
      first: sql<string>`min(${statementLine.bookedOn})::text`,
    })
    .from(entryPart)
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(and(sql`${entryPart.entryId} = ${among}`, eq(entryPart.role, "payment")))
    .groupBy(entryPart.entryId);

  const firstOf = new Map(firsts.map((each) => [each.entryId, each.first]));

  for (const each of left) {
    const first = firstOf.get(each.id);

    const cameFromGone = gone.some(
      (payment) => payment.entryId === each.id && payment.bookedOn === each.happenedOn,
    );

    if (first !== undefined && cameFromGone && first > each.happenedOn) {
      await transaction.update(entry).set({ happenedOn: first }).where(eq(entry.id, each.id));
    }
  }
}

/**
 * Settles the user's entries after payments left them (`gone`: a line's deletion, a pairing, an
 * unlinking): an entry whose refunds now come to more than its payments loses its refunds, and an
 * entry left without a payment goes. An expense never costs less than nothing (docs/data-model.md,
 * #27). The lines of the refunds taken off are an expense or an income again on their own: each
 * gets its default entry back, in this same transaction. An entry left happens on its first
 * payment's day when its day came from a payment gone. How many entries went.
 */
export async function settleEntries(
  transaction: UserTransaction,
  owner: string,
  gone: ReadonlyArray<PaymentGone>,
): Promise<number> {
  await followFirstPayments(transaction, gone);

  const overRefunded = await transaction
    .select({ entryId: entryPart.entryId })
    .from(entryPart)
    .groupBy(entryPart.entryId)
    .having(
      sql`sum(case when ${entryPart.role} = 'payment' then ${entryPart.amountMinor} else -${entryPart.amountMinor} end) < 0`,
    );

  const refundsOff =
    overRefunded.length === 0
      ? []
      : await transaction
          .delete(entryPart)
          .where(
            and(
              inArray(
                entryPart.entryId,
                overRefunded.map((each) => each.entryId),
              ),
              eq(entryPart.role, "refund"),
            ),
          )
          .returning({ lineId: entryPart.lineId });

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

  await entriesForLines(transaction, owner, [
    ...refundsOff.map((part) => part.lineId),
    ...freed.map((part) => part.lineId),
  ]);

  return dropped.length;
}

/**
 * Deletes the parts of every line of the user's that is a side of a transfer, then the entries left
 * the pairing leaves unsettled (`settleEntries`): a line just paired stops being an expense or an
 * income.
 */
export async function dropEntriesOfTransferSides(
  transaction: UserTransaction,
  owner: string,
): Promise<void> {
  const taken = await transaction
    .delete(entryPart)
    .where(
      exists(
        transaction
          .select({ id: transfer.id })
          .from(transfer)
          .where(
            or(eq(transfer.outLineId, entryPart.lineId), eq(transfer.inLineId, entryPart.lineId)),
          ),
      ),
    )
    .returning({ entryId: entryPart.entryId, lineId: entryPart.lineId, role: entryPart.role });

  const payments = taken.filter((part) => part.role === "payment");

  const days =
    payments.length === 0
      ? []
      : await transaction
          .select({ id: statementLine.id, bookedOn: statementLine.bookedOn })
          .from(statementLine)
          .where(
            inArray(
              statementLine.id,
              payments.map((part) => part.lineId),
            ),
          );

  const dayOf = new Map(days.map((line) => [line.id, line.bookedOn]));

  await settleEntries(
    transaction,
    owner,
    payments.flatMap((part) => {
      const bookedOn = dayOf.get(part.lineId);

      return bookedOn === undefined ? [] : [{ entryId: part.entryId, bookedOn }];
    }),
  );
}
