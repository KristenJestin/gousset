import { account, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { Effect, Result } from "effect";

import { MAX_TOP_UP_DAYS } from "../account-values";
import { takeCategoryTurn } from "../category-turn";
import { shiftDay } from "../transfers/pairing";
import { linkIn, lockLines } from "./expenses";
import { drainingLines, issuerKey, namesIssuer, topUpPairs } from "./top-up-match";
import type { TopUpBankLine, TopUpCardLine } from "./top-up-match";

// Meal-voucher top-ups matched into one expense (#28; docs/data-model.md, `entry_part`): a benefit
// card's line that paid all the card could, and the bank line that names its issuer within its
// days, become one expense with two payments, linked as the user links two lines (`linkIn`). It
// runs at the end of each import, after the rules, once at every boot after the recognition of the
// merchants, and when a benefit account's settings change. It never touches a line the user
// classified, split, linked or took out of an expense (`link_refused`), and a second run finds
// nothing left to do. Two candidates make nothing: the lines wait in the review.

/**
 * The day passed to `linkIn` as today: the matching reads every line, whatever its booking day, so
 * that a line dated ahead is matched as it will be.
 */
const ANY_DAY = "9999-12-31";

/** A line that is an expense of its own, and how its one entry was classified. */
type Alone = { readonly classifiedBy: "default" | "rule" };

/**
 * The lines among `lineIds` that are an expense of their own: one entry, of that line alone, an
 * expense not classified by the user, and no refusal of the user's. A side of a transfer has no
 * entry, a split line several, a linked line an entry of several parts: none of them is here.
 */
async function linesAlone(
  transaction: UserTransaction,
  lineIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, Alone>> {
  if (lineIds.length === 0) {
    return new Map();
  }

  const rows = await transaction
    .select({
      lineId: entryPart.lineId,
      kind: entry.kind,
      classifiedBy: entry.classifiedBy,
      refused: statementLine.linkRefused,
      parts: sql<number>`(select count(*)::int from entry_part p where p.entry_id = ${entry.id})`,
    })
    .from(entryPart)
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(inArray(entryPart.lineId, [...lineIds]));

  const count = new Map<string, number>();

  for (const row of rows) {
    count.set(row.lineId, (count.get(row.lineId) ?? 0) + 1);
  }

  return new Map(
    rows.flatMap((row): ReadonlyArray<readonly [string, Alone]> => {
      const classifiedBy = row.classifiedBy;

      return count.get(row.lineId) !== 1 ||
        row.parts !== 1 ||
        row.kind !== "expense" ||
        row.refused ||
        classifiedBy === "user"
        ? []
        : [[row.lineId, { classifiedBy }]];
    }),
  );
}

/**
 * Matches the user's top-ups in `owner`'s transaction, and gives how many expenses it made. Takes
 * the user's turn among the changes of the categories first (`../category-turn`), as recognition
 * does, so that two runs, or a run and a default's change, take turns.
 */
export async function matchTopUpsIn(transaction: UserTransaction, owner: string): Promise<number> {
  await takeCategoryTurn(transaction, owner);

  const cards = (
    await transaction
      .select({
        id: account.id,
        currency: account.currency,
        institution: account.institution,
        openingBalanceMinor: account.openingBalanceMinor,
        topUpDays: account.topUpDays,
        topUpCapMinor: account.topUpCapMinor,
      })
      .from(account)
      .where(
        and(eq(account.kind, "benefit"), eq(account.mode, "lines"), isNotNull(account.institution)),
      )
  ).flatMap((card) => {
    const issuer = issuerKey(card.institution);

    return issuer === null ? [] : [{ ...card, issuer }];
  });

  if (cards.length === 0) {
    return 0;
  }

  const cardRows = await transaction
    .select({
      id: statementLine.id,
      accountId: statementLine.accountId,
      bookedOn: statementLine.bookedOn,
      amountMinor: statementLine.amountMinor,
      source: statementLine.source,
    })
    .from(statementLine)
    .where(
      and(
        inArray(
          statementLine.accountId,
          cards.map((card) => card.id),
        ),
        eq(statementLine.state, "counted"),
      ),
    )
    .orderBy(asc(statementLine.bookedOn), asc(statementLine.id));

  // Each card's balance is replayed in order: the lines that paid all it could are candidates.
  const candidates: Array<TopUpCardLine> = [];

  for (const card of cards) {
    const own = cardRows.filter((row) => row.accountId === card.id);
    const drained = drainingLines(card.openingBalanceMinor, own, card.topUpCapMinor);

    for (const row of own) {
      if (drained.has(row.id) && row.source !== "balance") {
        candidates.push({
          id: row.id,
          bookedOn: row.bookedOn,
          currency: card.currency,
          issuer: card.issuer,
          days: card.topUpDays,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return 0;
  }

  const days = candidates.map((card) => card.bookedOn).toSorted();
  const first = days[0] ?? "";
  const last = days.at(-1) ?? "";

  const pool = await transaction
    .select({
      id: statementLine.id,
      bookedOn: statementLine.bookedOn,
      currency: account.currency,
      label: statementLine.label,
      memo: statementLine.memo,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        ne(account.kind, "benefit"),
        eq(statementLine.state, "counted"),
        ne(statementLine.source, "balance"),
        eq(statementLine.linkRefused, false),
        lt(statementLine.amountMinor, 0),
        gte(statementLine.bookedOn, first),
        lte(statementLine.bookedOn, shiftDay(last, MAX_TOP_UP_DAYS)),
        inArray(account.currency, [...new Set(cards.map((card) => card.currency))]),
      ),
    );

  const issuers = [...new Set(cards.map((card) => card.issuer))];

  const banks = pool.flatMap((row): ReadonlyArray<TopUpBankLine> => {
    const texts = [row.label, row.memo, row.counterpartyName];

    return issuers.some((issuer) => namesIssuer(texts, issuer))
      ? [{ id: row.id, bookedOn: row.bookedOn, currency: row.currency, texts }]
      : [];
  });

  if (banks.length === 0) {
    return 0;
  }

  // Every line that may be matched is locked first, in one order, then read again: what the user
  // classified or linked meanwhile is left alone.
  const ids = [...candidates.map((card) => card.id), ...banks.map((line) => line.id)];

  await lockLines(transaction, ids);

  const alone = await linesAlone(transaction, ids);

  const pairs = topUpPairs(
    candidates.filter((card) => alone.has(card.id)),
    banks.filter((line) => alone.has(line.id)),
  );

  let made = 0;

  for (const pair of pairs) {
    // The expense kept is the one a rule classified, the card line's otherwise: its merchant is
    // the shop, where the bank line names the issuer.
    const keepBank =
      alone.get(pair.bankLineId)?.classifiedBy === "rule" &&
      alone.get(pair.cardLineId)?.classifiedBy !== "rule";

    const linked = keepBank
      ? await linkIn(transaction, owner, pair.cardLineId, pair.bankLineId, ANY_DAY, "match")
      : await linkIn(transaction, owner, pair.bankLineId, pair.cardLineId, ANY_DAY, "match");

    if (Result.isSuccess(linked)) {
      made += 1;
    }
  }

  return made;
}

/** Matches the user's top-ups, in a transaction of their own: what the boot job runs. */
export const matchTopUps = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, (transaction) => matchTopUpsIn(transaction, owner));
  });
