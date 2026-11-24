import { account, accountBalance, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { Effect } from "effect";

import { balanceMovements } from "./balance-movements";
import { takeCategoryTurn } from "./category-turn";
import { dropEntriesWithoutParts, entriesForLines } from "./entries";

// An account kept by its balance (#31; docs/data-model.md, v0.3, "Balance mode"): every noted
// balance makes one line (`source = balance`, its `balance_id`), the movement since the balance
// before it less the account's other lines booked in between (the transfers known, the lines
// entered by hand), and that line one expense or income in the account's chosen category. Whatever
// may change a movement (a balance noted, the account's settings, a side the app makes or deletes on
// it, an import or its undo) calls `remakeBalanceLines` in the transaction that changes it, so that
// no commit leaves a movement that disagrees with its balances; a boot job calls it once for every
// user, for the balances noted before v0.3. Its arithmetic is `./balance-movements`.

const summed = () =>
  sql<number>`coalesce(sum(${statementLine.amountMinor}), 0)::bigint`.mapWith(Number);

/** A movement line to make: one noted balance's. */
type Fresh = {
  readonly accountId: string;
  readonly balanceId: string;
  readonly bookedOn: string;
  readonly amountMinor: number;
};

/**
 * Makes the movement lines of the user's accounts agree with their noted balances, in `owner`'s
 * transaction, and their entries with the accounts' categories. Takes the user's turn among the
 * changes of the categories first (`./category-turn`), which also keeps two remakes of the user's
 * apart: a caller takes it at the start of its transaction, before any row lock.
 *
 * - An account kept by its balance gets one line per noted balance, booked on its day, with no
 *   label (the interface names it). A line whose amount changed is written again with its new
 *   amount, and gets a new entry; one whose amount did not is left as it is, with its entry, so that
 *   a classification by hand stays. A movement of zero is a line of no amount, with no entry.
 * - An account kept by its lines has none: its lines made from balances are deleted, with their
 *   entries.
 * - An entry of a movement still classified by default goes to its account's category when that
 *   category is of the entry's kind and not archived, and back to its kind's fallback when the
 *   account has no category or one of the other kind. An archived category classifies nothing new
 *   and keeps what it has, as a merchant's default does.
 */
export async function remakeBalanceLines(
  transaction: UserTransaction,
  owner: string,
): Promise<void> {
  await takeCategoryTurn(transaction, owner);

  const accounts = await transaction
    .select({
      id: account.id,
      mode: account.mode,
      openingBalanceMinor: account.openingBalanceMinor,
    })
    .from(account);

  const kept = accounts.filter((each) => each.mode === "balance");
  const byLines = accounts.flatMap((each) => (each.mode === "lines" ? [each.id] : []));

  // A line's parts go with it (`on delete cascade`); the entries left with none go below.
  if (byLines.length > 0) {
    await transaction
      .delete(statementLine)
      .where(and(eq(statementLine.source, "balance"), inArray(statementLine.accountId, byLines)));
  }

  const touched: Array<string> = [];

  if (kept.length > 0) {
    const keptIds = kept.map((each) => each.id);

    const noted = await transaction
      .select({
        id: accountBalance.id,
        accountId: accountBalance.accountId,
        day: accountBalance.day,
        minor: accountBalance.balanceMinor,
      })
      .from(accountBalance)
      .where(and(eq(accountBalance.source, "noted"), inArray(accountBalance.accountId, keptIds)))
      .orderBy(asc(accountBalance.day), asc(accountBalance.id));

    // The other counted lines, summed by account and day: only their sum between two noted
    // balances matters.
    const others = await transaction
      .select({
        accountId: statementLine.accountId,
        bookedOn: statementLine.bookedOn,
        amountMinor: summed(),
      })
      .from(statementLine)
      .where(
        and(
          inArray(statementLine.accountId, keptIds),
          eq(statementLine.state, "counted"),
          ne(statementLine.source, "balance"),
        ),
      )
      .groupBy(statementLine.accountId, statementLine.bookedOn);

    const made = await transaction
      .select({
        id: statementLine.id,
        balanceId: statementLine.balanceId,
        amountMinor: statementLine.amountMinor,
      })
      .from(statementLine)
      .where(and(eq(statementLine.source, "balance"), inArray(statementLine.accountId, keptIds)));

    const madeOf = new Map(made.map((line) => [line.balanceId, line]));
    const changed: Array<{ readonly id: string; readonly amountMinor: number }> = [];
    const fresh: Array<Fresh> = [];

    for (const each of kept) {
      const balances = noted.filter((balance) => balance.accountId === each.id);

      const movements = balanceMovements(
        each.openingBalanceMinor,
        balances,
        others.filter((line) => line.accountId === each.id),
      );

      for (const [index, balance] of balances.entries()) {
        const amountMinor = movements[index]?.minor ?? 0;
        const line = madeOf.get(balance.id);

        if (line === undefined) {
          fresh.push({
            accountId: each.id,
            balanceId: balance.id,
            bookedOn: balance.day,
            amountMinor,
          });
        } else if (line.amountMinor !== amountMinor) {
          changed.push({ id: line.id, amountMinor });
        }
      }
    }

    for (const line of changed) {
      await transaction
        .update(statementLine)
        .set({ amountMinor: line.amountMinor })
        .where(eq(statementLine.id, line.id));
    }

    const changedIds = changed.map((line) => line.id);

    // A movement that changed is an expense or an income of its new amount, maybe of the other kind:
    // its entry is made again.
    if (changedIds.length > 0) {
      await transaction.delete(entryPart).where(inArray(entryPart.lineId, changedIds));
    }

    // Two remakes never run at once (the turn above): a line already made is no conflict.
    const inserted =
      fresh.length === 0
        ? []
        : await transaction
            .insert(statementLine)
            .values(
              fresh.map((line) => ({
                userId: owner,
                accountId: line.accountId,
                source: "balance" as const,
                balanceId: line.balanceId,
                bookedOn: line.bookedOn,
                amountMinor: line.amountMinor,
                label: "",
              })),
            )
            .onConflictDoNothing()
            .returning({ id: statementLine.id });

    touched.push(...changedIds, ...inserted.map((line) => line.id));
  }

  await dropEntriesWithoutParts(transaction);
  await entriesForLines(transaction, owner, touched);
  await placeBalanceEntries(transaction);
}

/**
 * Puts the entries of the movements still classified by default in their account's category, or
 * back in their kind's fallback (`remakeBalanceLines` says when). Every value is a column: nothing
 * of the user's goes into the statements' text.
 */
async function placeBalanceEntries(transaction: UserTransaction): Promise<void> {
  await transaction.execute(sql`
    update entry e set category_id = a.balance_category_id
    from entry_part p, statement_line l, account a, category c
    where p.entry_id = e.id and l.id = p.line_id and l.source = 'balance'
      and a.id = l.account_id and a.mode = 'balance' and c.id = a.balance_category_id
      and c.kind = e.kind and c.archived_at is null
      and e.classified_by = 'default' and e.category_id <> a.balance_category_id`);

  await transaction.execute(sql`
    update entry e set category_id = f.id
    from entry_part p, statement_line l, account a, category f
    where p.entry_id = e.id and l.id = p.line_id and l.source = 'balance'
      and a.id = l.account_id and f.user_id = e.user_id and f.is_fallback and f.kind = e.kind
      and e.classified_by = 'default' and e.category_id <> f.id
      and not exists (
        select 1 from category c where c.id = a.balance_category_id and c.kind = e.kind
      )`);
}

/**
 * The movement lines of every account of the user's made again from their noted balances
 * (`remakeBalanceLines`), in a transaction of their own: what the boot job runs, so that the
 * balances noted before v0.3 get theirs. Nothing changes once they agree.
 */
export const remakeEveryBalanceLine = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    yield* userData.transaction(owner, (transaction) => remakeBalanceLines(transaction, owner));
  });
