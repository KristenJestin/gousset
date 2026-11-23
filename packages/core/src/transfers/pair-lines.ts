import { account, statementLine } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, gte, inArray, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { SQL, SQLWrapper } from "drizzle-orm";

import {
  CARD_DAYS,
  TRANSFER_DAYS,
  candidateFinder,
  cardDebits,
  clearPairs,
  replacedCounterparts,
  shiftDay,
} from "./pairing";
import type { CardLedger, Pair, PairableLine } from "./pairing";

// The pairing as it writes (#26): after an import, in the transaction that ends it, and on demand.
// Every value goes in as a parameter; every row is the user's, through `UserData`.

/** How many days around a line its candidates are looked for: value dates may be further apart. */
export const POOL_DAYS = TRANSFER_DAYS + 14;

/** A line that is no side of any transfer yet. */
export const notPaired = sql`not exists (select 1 from ${transfer} where ${transfer.outLineId} = ${statementLine.id} or ${transfer.inLineId} = ${statementLine.id})`;

/**
 * A line that may be a side of a transfer: counted, of some amount, not made from a noted balance
 * (it stands for a month's movement, #31), and no side of one yet.
 */
const pairable = and(
  eq(statementLine.state, "counted"),
  ne(statementLine.source, "balance"),
  ne(statementLine.amountMinor, 0),
  notPaired,
);

/** A pairable line, with its label for the side the app makes from it, and its review. */
export type PoolLine = PairableLine & {
  readonly label: string;
  readonly reviewState: "to_review" | "done";
};

/** The pairable lines `where` selects, with their account's currency. */
export function pairableLines(
  transaction: UserTransaction,
  where: SQL | undefined,
): Promise<ReadonlyArray<PoolLine>> {
  return transaction
    .select({
      id: statementLine.id,
      accountId: statementLine.accountId,
      currency: account.currency,
      bookedOn: statementLine.bookedOn,
      valueOn: statementLine.valueOn,
      amountMinor: statementLine.amountMinor,
      label: statementLine.label,
      reviewState: statementLine.reviewState,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(and(pairable, where));
}

const bookedBetween = (from: string, to: string) =>
  and(gte(statementLine.bookedOn, from), lte(statementLine.bookedOn, to));

/** Which lines a pairing looks at: one import's, or every line of the user's. */
export type PairingScope =
  | {
      readonly kind: "import";
      readonly importId: string;
      readonly accountId: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: "all" };

/** What a pairing wrote. */
export type PairingWritten = {
  /** Transfers made between two lines that were there. */
  readonly paired: number;
  /** Transfers made with a side the app made: a deferred card's monthly debit. */
  readonly cardDebits: number;
  /** Sides the app had made that a file now brings, the transfer moved to the file's line. */
  readonly replaced: number;
};

async function insertPairs(
  transaction: UserTransaction,
  owner: string,
  pairs: ReadonlyArray<Pair>,
  pairedBy: "import" | "user",
): Promise<number> {
  if (pairs.length === 0) {
    return 0;
  }

  // Another pairing running at once may have taken a side meanwhile: that pair is skipped.
  const written = await transaction
    .insert(transfer)
    .values(pairs.map((pair) => ({ userId: owner, ...pair, pairedBy })))
    .onConflictDoNothing()
    .returning({ id: transfer.id });

  return written.length;
}

/** The sides the app made on `accountId`'s lines (or every account's) that are paired. */
function madeSides(transaction: UserTransaction, where: SQL | undefined) {
  return transaction
    .select({
      id: statementLine.id,
      accountId: statementLine.accountId,
      currency: account.currency,
      bookedOn: statementLine.bookedOn,
      valueOn: statementLine.valueOn,
      amountMinor: statementLine.amountMinor,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(and(eq(statementLine.source, "counterpart"), where));
}

/** Moves each transfer from the side the app made to the file's line, then deletes the made one. */
async function replaceMadeSides(
  transaction: UserTransaction,
  fresh: ReadonlyArray<PoolLine>,
  made: ReadonlyArray<PairableLine>,
): Promise<ReadonlySet<string>> {
  const replacements = replacedCounterparts(fresh, made);

  for (const { counterpartId, lineId } of replacements) {
    await transaction
      .update(transfer)
      .set({ inLineId: lineId })
      .where(eq(transfer.inLineId, counterpartId));

    await transaction
      .update(transfer)
      .set({ outLineId: lineId })
      .where(eq(transfer.outLineId, counterpartId));

    await transaction.delete(statementLine).where(eq(statementLine.id, counterpartId));
  }

  return new Set(replacements.map((replacement) => replacement.lineId));
}

/** The deferred cards settling into `accountIds`, with their lines over `from` to `to`. */
async function cardLedgers(
  transaction: UserTransaction,
  accountIds: ReadonlyArray<string>,
  from: string,
  to: string,
): Promise<ReadonlyArray<CardLedger>> {
  if (accountIds.length === 0) {
    return [];
  }

  const cards = await transaction
    .select({
      id: account.id,
      currency: account.currency,
      settlesInto: account.settlesIntoAccountId,
      opening: account.openingBalanceMinor,
    })
    .from(account)
    .where(and(eq(account.kind, "card"), inArray(account.settlesIntoAccountId, [...accountIds])));

  const ledgers: Array<CardLedger> = [];

  for (const card of cards) {
    if (card.settlesInto === null) {
      continue;
    }

    const counted = and(eq(statementLine.accountId, card.id), eq(statementLine.state, "counted"));

    const [before] = await transaction
      .select({
        total: sql<number>`coalesce(sum(${statementLine.amountMinor}), 0)::bigint`.mapWith(Number),
      })
      .from(statementLine)
      .where(and(counted, lt(statementLine.bookedOn, from)));

    const lines = await transaction
      .select({ bookedOn: statementLine.bookedOn, amountMinor: statementLine.amountMinor })
      .from(statementLine)
      .where(and(counted, bookedBetween(from, to)));

    ledgers.push({
      accountId: card.id,
      currency: card.currency,
      settlesInto: card.settlesInto,
      balanceBefore: card.opening + (before?.total ?? 0),
      lines,
    });
  }

  return ledgers;
}

/**
 * Pairs a deferred card's monthly debits among `targets` (lines with no candidate of their own):
 * for each, the app makes the card's side (`source = counterpart`), and the transfer between them.
 * The lines it paired.
 */
async function pairCardDebitsOnce(
  transaction: UserTransaction,
  owner: string,
  targets: ReadonlyArray<PoolLine>,
): Promise<ReadonlySet<string>> {
  const out = targets.filter((line) => line.amountMinor < 0);
  const paired = new Set<string>();

  if (out.length === 0) {
    return paired;
  }

  const days = out.map((line) => line.bookedOn).toSorted();
  const first = days[0] ?? "";
  const last = days.at(-1) ?? "";

  const cards = await cardLedgers(
    transaction,
    [...new Set(out.map((line) => line.accountId))],
    shiftDay(first, -CARD_DAYS),
    last,
  );

  const debits = cardDebits(out, cards);
  const byId = new Map(out.map((line) => [line.id, line]));

  for (const debit of debits) {
    const line = byId.get(debit.lineId);

    if (line === undefined) {
      continue;
    }

    const [made] = await transaction
      .insert(statementLine)
      .values({
        userId: owner,
        accountId: debit.cardAccountId,
        source: "counterpart",
        bookedOn: line.bookedOn,
        valueOn: line.valueOn,
        amountMinor: -line.amountMinor,
        label: line.label,
      })
      .returning({ id: statementLine.id });

    if (
      made !== undefined &&
      (await insertPairs(
        transaction,
        owner,
        [{ outLineId: line.id, inLineId: made.id }],
        "import",
      )) > 0
    ) {
      paired.add(line.id);
    }
  }

  return paired;
}

/** How many rounds of a card's debits one pairing makes at most: two years of months. */
const CARD_ROUNDS = 24;

/**
 * `pairCardDebitsOnce`, again while it pairs: a card's balance owed at the end of a month counts the
 * months before it until their debits are paired, so each month's debit is found in its own round,
 * the oldest first. How many it paired.
 */
async function pairCardDebits(
  transaction: UserTransaction,
  owner: string,
  targets: ReadonlyArray<PoolLine>,
): Promise<number> {
  let left = targets;
  let written = 0;

  for (let round = 0; round < CARD_ROUNDS && left.length > 0; round += 1) {
    const paired = await pairCardDebitsOnce(transaction, owner, left);

    if (paired.size === 0) {
      break;
    }

    written += paired.size;
    left = left.filter((line) => !paired.has(line.id));
  }

  return written;
}

/**
 * Pairs the transfers among the lines of `scope` (docs/data-model.md, v0.3, `transfer`): a side the
 * app had made that a file now brings is replaced by the file's line; two lines that are each the
 * other's only candidate are paired; a line out of an account a deferred card settles into, with
 * no candidate, that pays what the card owed, is paired with a side the app makes on the card. A
 * line with several candidates is left as it is, for the user. Safe to run again: a paired line is
 * no candidate any more.
 */
export async function pairTransfers(
  transaction: UserTransaction,
  owner: string,
  scope: PairingScope,
): Promise<PairingWritten> {
  const imported = scope.kind === "import";

  const fresh = await pairableLines(
    transaction,
    imported ? eq(statementLine.importId, scope.importId) : undefined,
  );

  const made = await madeSides(
    transaction,
    imported
      ? and(
          eq(statementLine.accountId, scope.accountId),
          bookedBetween(shiftDay(scope.from, -TRANSFER_DAYS), shiftDay(scope.to, TRANSFER_DAYS)),
        )
      : undefined,
  );

  // Made sides are paired, so never among the fresh lines.
  const replaced = await replaceMadeSides(transaction, fresh, made);

  // A card's file may make a debit of its current account payable, booked up to a month after.
  const cardOf = imported
    ? await transaction
        .select({ settlesInto: account.settlesIntoAccountId })
        .from(account)
        .where(and(eq(account.id, scope.accountId), eq(account.kind, "card")))
    : [];

  const settlesInto = cardOf[0]?.settlesInto ?? null;

  const pool = imported
    ? await pairableLines(
        transaction,
        bookedBetween(
          shiftDay(scope.from, -POOL_DAYS),
          shiftDay(scope.to, (settlesInto === null ? 0 : CARD_DAYS) + POOL_DAYS),
        ),
      )
    : fresh;

  const left = fresh.filter((line) => !replaced.has(line.id));
  const available = pool.filter((line) => !replaced.has(line.id));
  const pairs = clearPairs(left, available);
  const paired = await insertPairs(transaction, owner, pairs, "import");
  const taken = new Set(pairs.flatMap((pair) => [pair.outLineId, pair.inLineId]));

  const debits =
    scope.kind === "import" && settlesInto !== null
      ? available.filter(
          (line) =>
            line.accountId === settlesInto &&
            line.bookedOn >= scope.from &&
            line.bookedOn <= shiftDay(scope.to, CARD_DAYS),
        )
      : left;

  const candidates = candidateFinder(available);

  const targets = debits.filter((line) => !taken.has(line.id) && candidates(line).length === 0);

  return {
    paired,
    cardDebits: await pairCardDebits(transaction, owner, targets),
    replaced: replaced.size,
  };
}

/**
 * The user's lines that wait for the user to choose their transfer's other side: still to review,
 * no side of a transfer, with several candidates; booked on or before `day` when given.
 */
export async function linesWithSeveralCandidates(
  transaction: UserTransaction,
  day?: string,
): Promise<ReadonlyArray<string>> {
  const pool = await pairableLines(
    transaction,
    day === undefined ? undefined : lte(statementLine.bookedOn, day),
  );

  const candidates = candidateFinder(pool);

  return pool.flatMap((line) =>
    line.reviewState === "to_review" && candidates(line).length > 1 ? [line.id] : [],
  );
}

/**
 * Undoing an import (docs/data-model.md, "Undoing an import from v0.3"): the transfers of the lines
 * `lineIds` selects go with them, by their foreign keys; the sides the app made for those transfers
 * are deleted here, since no file will ever bring them back, and the other sides go back to the
 * review. How many transfers go.
 */
export async function unpairForUndo(
  transaction: UserTransaction,
  lineIds: SQLWrapper,
): Promise<number> {
  const gone = await transaction
    .select({ outLineId: transfer.outLineId, inLineId: transfer.inLineId })
    .from(transfer)
    .where(or(inArray(transfer.outLineId, lineIds), inArray(transfer.inLineId, lineIds)));

  const sides = gone.flatMap((each) => [each.outLineId, each.inLineId]);

  if (sides.length > 0) {
    await transaction
      .delete(statementLine)
      .where(and(inArray(statementLine.id, sides), eq(statementLine.source, "counterpart")));

    // The undone import's own lines are deleted next; the others are no transfer any more.
    await transaction
      .update(statementLine)
      .set({ reviewState: "to_review" })
      .where(and(inArray(statementLine.id, sides), notInArray(statementLine.id, lineIds)));
  }

  return gone.length;
}
