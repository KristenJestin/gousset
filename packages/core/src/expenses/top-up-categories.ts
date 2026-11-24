import { account, category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import type { DefaultScope } from "../merchants/default-classification";
import { issuerKey, namesIssuer } from "./top-up-match";

// A top-up of a benefit card kept by its balance (#28, #31): with no line of the card's to match it
// with, the bank line that names the card's issuer goes to the card's category, as the card's own
// movement does. Still classified by default, a guess a rule overwrites and the review lists. It is
// applied where the merchants' defaults are (`classifyByMerchants`), after them, so that whatever
// moves entries by default leaves top-ups in their card's category.

/** How many entry ids one update names. */
const CHUNK = 500;

/**
 * Puts each entry still classified by default, an expense of one bank line that names the issuer of
 * exactly one benefit card, a card kept by its balance with an expense category not archived, in
 * that category, within `scope`. Gives how many moved.
 */
export async function topUpsToBalanceCategories(
  transaction: UserTransaction,
  scope: DefaultScope,
): Promise<number> {
  if ("lineIds" in scope && scope.lineIds.length === 0) {
    return 0;
  }

  const cards = (
    await transaction
      .select({
        id: account.id,
        mode: account.mode,
        currency: account.currency,
        institution: account.institution,
        categoryId: category.id,
        categoryKind: category.kind,
        archivedAt: category.archivedAt,
      })
      .from(account)
      .leftJoin(category, eq(category.id, account.balanceCategoryId))
      .where(and(eq(account.kind, "benefit"), isNotNull(account.institution)))
  ).flatMap((card) => {
    const issuer = issuerKey(card.institution);

    return issuer === null ? [] : [{ ...card, issuer }];
  });

  const kept = (card: (typeof cards)[number]) =>
    card.mode === "balance" && card.categoryKind === "expense" && card.archivedAt === null;

  if (!cards.some(kept)) {
    return 0;
  }

  const rows = await transaction
    .select({
      id: entry.id,
      categoryId: entry.categoryId,
      currency: account.currency,
      label: statementLine.label,
      memo: statementLine.memo,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(entry)
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(entry.classifiedBy, "default"),
        eq(entry.kind, "expense"),
        ne(account.kind, "benefit"),
        lt(statementLine.amountMinor, 0),
        sql`(select count(*) from entry_part p where p.entry_id = ${entry.id}) = 1`,
        "lineIds" in scope ? inArray(entryPart.lineId, [...scope.lineIds]) : undefined,
      ),
    );

  const byTarget = new Map<string, Array<string>>();

  for (const row of rows) {
    const texts = [row.label, row.memo, row.counterpartyName];

    const named = cards.filter(
      (card) => card.currency === row.currency && namesIssuer(texts, card.issuer),
    );

    const [only, ...others] = named;
    const target = only === undefined || others.length > 0 || !kept(only) ? null : only.categoryId;

    if (target !== null && target !== row.categoryId) {
      byTarget.set(target, [...(byTarget.get(target) ?? []), row.id]);
    }
  }

  let moved = 0;

  for (const [categoryId, ids] of byTarget) {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const updated = await transaction
        .update(entry)
        .set({ categoryId })
        .where(
          and(
            inArray(entry.id, ids.slice(start, start + CHUNK)),
            eq(entry.classifiedBy, "default"),
          ),
        )
        .returning({ id: entry.id });

      moved += updated.length;
    }
  }

  return moved;
}
