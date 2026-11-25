import {
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import type { EntryKind } from "../category-store";
import type { CategoryOperation } from "../default-categories";
import { topUpsToBalanceCategories } from "../expenses/top-up-categories";
import { merchantKey, operationOf } from "./labels";

// A merchant's default category classifies its entries (#23, docs/data-model.md, v0.3): an entry
// still classified by default (`classified_by = default`), of the category's kind, goes in it, and
// stays classified by default, a guess the review still lists and a rule may overwrite. An entry the
// user classified is never touched. The merchant is read from the entry's line, as #24 reads it: its
// cleaned label, named by an alias. It applies at recognition (each import, and every boot) and
// whenever a merchant's default is set, changed or cleared. A line of a loan, a fee or interest
// names no merchant (#194): its entry goes, the same way, in the category marked with its
// operation (`category.operation`), of its kind.

/**
 * An entry as the classification reads it: its line's merchant, or null for none or several; the
 * operation its line's prefix says, when that is one a category takes (a loan, a fee, interest).
 */
export type DefaultEntry = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly categoryId: string;
  readonly classifiedBy: "default" | "rule" | "user";
  readonly merchantId: string | null;
  readonly operation: CategoryOperation | null;
};

/** A merchant's default category, with its kind, and whether it is archived. */
export type MerchantDefault = {
  readonly categoryId: string;
  readonly kind: EntryKind;
  readonly archived: boolean;
};

/** An entry moved, and where. */
export type EntryMove = { readonly entryId: string; readonly categoryId: string };

/**
 * The entries a merchant's default category moves: each one still classified by default, of a
 * merchant, goes to that merchant's default category when it is of the entry's kind, else back to
 * its kind's fallback. A default archived classifies nothing new and keeps what it has: its
 * merchant's entries stay where they are. An entry of no merchant, of an operation a category
 * takes, goes to the category `operations` gives for its kind and operation (`<kind>/<operation>`,
 * none archived), and stays where it is when none is. An entry where it should be is left out.
 */
export function defaultCategoryMoves(
  entries: ReadonlyArray<DefaultEntry>,
  defaults: ReadonlyMap<string, MerchantDefault>,
  fallbacks: ReadonlyMap<EntryKind, string>,
  operations: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<EntryMove> {
  return entries.flatMap((each): ReadonlyArray<EntryMove> => {
    if (each.classifiedBy !== "default") {
      return [];
    }

    if (each.merchantId === null) {
      const marked =
        each.operation === null ? undefined : operations.get(`${each.kind}/${each.operation}`);

      return marked === undefined || marked === each.categoryId
        ? []
        : [{ entryId: each.id, categoryId: marked }];
    }

    const chosen = defaults.get(each.merchantId);

    if (chosen?.archived === true) {
      return [];
    }

    const target =
      chosen !== undefined && chosen.kind === each.kind
        ? chosen.categoryId
        : fallbacks.get(each.kind);

    return target === undefined || target === each.categoryId
      ? []
      : [{ entryId: each.id, categoryId: target }];
  });
}

/** Which entries to classify: every merchant's, one merchant's, or those of some lines. */
export type DefaultScope =
  | { readonly every: true }
  | { readonly merchantId: string }
  | { readonly lineIds: ReadonlyArray<string> };

/** How many entry ids one update names. */
const CHUNK = 500;

/**
 * Puts the user's entries still classified by default in their merchant's default category, or
 * back in their kind's fallback, within `scope`, in `owner`'s transaction. Gives how many moved.
 * With every merchant and no default anywhere, nothing is read: every such entry is in its
 * fallback already, since each default set, changed or cleared moved its merchant's.
 */
export async function classifyByMerchants(
  transaction: UserTransaction,
  scope: DefaultScope,
): Promise<number> {
  const moved = await classifyByDefaults(transaction, scope);

  // A top-up of a card kept by its balance goes to the card's category, after the defaults (#28).
  await topUpsToBalanceCategories(transaction, "merchantId" in scope ? { every: true } : scope);

  return moved;
}

async function classifyByDefaults(
  transaction: UserTransaction,
  scope: DefaultScope,
): Promise<number> {
  if ("lineIds" in scope && scope.lineIds.length === 0) {
    return 0;
  }

  const defaultRows = await transaction
    .select({
      merchantId: merchant.id,
      categoryId: category.id,
      kind: category.kind,
      archivedAt: category.archivedAt,
    })
    .from(merchant)
    .innerJoin(category, eq(category.id, merchant.defaultCategoryId))
    .where(isNotNull(merchant.defaultCategoryId));

  // The categories marked with an operation, not archived: one merchant's scope needs none.
  const operationRows =
    "merchantId" in scope
      ? []
      : await transaction
          .select({ id: category.id, kind: category.kind, operation: category.operation })
          .from(category)
          .where(and(isNotNull(category.operation), isNull(category.archivedAt)));

  if (!("merchantId" in scope) && defaultRows.length === 0 && operationRows.length === 0) {
    return 0;
  }

  const operations = new Map(
    operationRows.map((row) => [`${row.kind}/${row.operation ?? ""}`, row.id]),
  );

  const defaults = new Map(
    defaultRows.map((row) => [
      row.merchantId,
      { categoryId: row.categoryId, kind: row.kind, archived: row.archivedAt !== null },
    ]),
  );

  const aliases = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias)
    .where("merchantId" in scope ? eq(merchantAlias.merchantId, scope.merchantId) : undefined);

  const merchantOf = new Map(aliases.map((row) => [row.alias, row.merchantId]));

  const fallbackRows = await transaction
    .select({ id: category.id, kind: category.kind })
    .from(category)
    .where(eq(category.isFallback, true));

  const fallbacks = new Map(fallbackRows.map((row) => [row.kind, row.id]));

  // Each entry still classified by default with the lines that pay it; an entry is one line's, a
  // split one's lines may name several merchants, and then none is its.
  const parts = await transaction
    .select({
      id: entry.id,
      kind: entry.kind,
      categoryId: entry.categoryId,
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(entry)
    .innerJoin(entryPart, and(eq(entryPart.entryId, entry.id), eq(entryPart.role, "payment")))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .where(
      and(
        eq(entry.classifiedBy, "default"),
        "lineIds" in scope ? inArray(entryPart.lineId, [...scope.lineIds]) : undefined,
      ),
    );

  const byEntry = new Map<string, DefaultEntry>();
  const several = new Set<string>();

  for (const part of parts) {
    const key = merchantKey(part.label, part.counterpartyName);
    const merchantId = key === null ? null : (merchantOf.get(key) ?? null);
    const read = operationOf(part.label);
    const operation = read === "loan" || read === "fee" || read === "interest" ? read : null;
    const known = byEntry.get(part.id);

    if (known === undefined) {
      byEntry.set(part.id, {
        id: part.id,
        kind: part.kind,
        categoryId: part.categoryId,
        classifiedBy: "default",
        merchantId,
        operation,
      });
    } else if (known.merchantId !== merchantId || known.operation !== operation) {
      several.add(part.id);
    }
  }

  // An entry paid by lines of several merchants or operations is none's.
  const entries = [...byEntry.values()].map((each) =>
    several.has(each.id) ? { ...each, merchantId: null, operation: null } : each,
  );

  const moves = defaultCategoryMoves(entries, defaults, fallbacks, operations);
  const byTarget = new Map<string, Array<string>>();

  for (const move of moves) {
    const ids = byTarget.get(move.categoryId);

    if (ids === undefined) {
      byTarget.set(move.categoryId, [move.entryId]);
    } else {
      ids.push(move.entryId);
    }
  }

  for (const [categoryId, ids] of byTarget) {
    for (let start = 0; start < ids.length; start += CHUNK) {
      await transaction
        .update(entry)
        .set({ categoryId })
        .where(
          and(
            inArray(entry.id, ids.slice(start, start + CHUNK)),
            eq(entry.classifiedBy, "default"),
          ),
        );
    }
  }

  return moves.length;
}
