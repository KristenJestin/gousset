import { entry, merchant, merchantAlias, rule, statementLine } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { Effect, Option } from "effect";

import { takeCategoryTurn } from "../category-turn";
import { formerMerchantKey, merchantKey, merchantName } from "./labels";
import { recogniseIn } from "./merchants";
import type { Recognised } from "./merchants";
import { mergeTownMerchantsIn } from "./town-merge";

// The merchants made before the operation prefixes (#194; docs/data-model.md, v0.3, "Operation
// prefixes"), read again once at every boot: a merchant recognition made from a label's prefix
// (`ANN CARTE SHOPLY`, `F COTISATION`, `ECH PRET`) names no line any longer, and goes when the
// user never touched it; its lines then get their merchant again, or none. Whatever the user
// changed stays as it is.

/**
 * What a re-read did: the merchants it forgot, those it merged into another of the same shop in
 * another town (#193), then what the recognition added.
 */
export type Reread = Recognised & { readonly forgotten: number; readonly merged: number };

/** How many ids or cleaned labels one query names. */
const CHUNK = 500;

function chunked<T>(items: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  return Array.from({ length: Math.ceil(items.length / CHUNK) }, (_chunk, index) =>
    items.slice(index * CHUNK, (index + 1) * CHUNK),
  );
}

/**
 * The cleaned labels that a line (counted or held) gave before the operation prefixes and none
 * gives now: what recognition named a merchant from, which names no line any longer.
 */
async function staleAliases(transaction: UserTransaction): Promise<ReadonlySet<string>> {
  const labels = await transaction
    .selectDistinct({
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(statementLine)
    .where(ne(statementLine.state, "discarded"));

  const given = new Set<string>();
  const former = new Set<string>();

  for (const row of labels) {
    const key = merchantKey(row.label, row.counterpartyName);
    const before = formerMerchantKey(row.label, row.counterpartyName);

    if (key !== null) {
      given.add(key);
    }

    if (before !== null && before !== key) {
      former.add(before);
    }
  }

  return new Set([...former].filter((key) => !given.has(key)));
}

/**
 * Forgets, in `owner`'s transaction, the merchants made from cleaned labels that no line gives
 * since the operation prefixes, each only when the user never touched it: every cleaned label it
 * has is such a one, and it still has the name recognition gave it from one of them; it has no
 * default category, is no intermediary, was never changed (a rename, a mark, a merge into it), and
 * no rule nor entry names it. Any other is left as it is. Gives how many went; their cleaned labels
 * go with them. Safe to run again: a second run finds none.
 */
export async function forgetOperationMerchantsIn(transaction: UserTransaction): Promise<number> {
  const stale = await staleAliases(transaction);

  if (stale.size === 0) {
    return 0;
  }

  const owners = new Set<string>();

  for (const part of chunked([...stale])) {
    const rows = await transaction
      .select({ merchantId: merchantAlias.merchantId })
      .from(merchantAlias)
      .where(inArray(merchantAlias.alias, [...part]));

    for (const row of rows) {
      owners.add(row.merchantId);
    }
  }

  const forgotten: Array<string> = [];

  for (const part of chunked([...owners])) {
    const ids = [...part];

    // Locked first: a rule or an entry naming one of them waits, or is seen below.
    const merchants = await transaction
      .select({
        id: merchant.id,
        name: merchant.name,
        defaultCategoryId: merchant.defaultCategoryId,
        intermediary: merchant.isIntermediary,
        createdAt: merchant.createdAt,
        updatedAt: merchant.updatedAt,
      })
      .from(merchant)
      .where(inArray(merchant.id, ids))
      .for("update");

    const aliases = await transaction
      .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
      .from(merchantAlias)
      .where(inArray(merchantAlias.merchantId, ids));

    const ruled = await transaction
      .selectDistinct({ id: rule.setMerchantId })
      .from(rule)
      .where(inArray(rule.setMerchantId, ids));

    const paid = await transaction
      .selectDistinct({ id: entry.merchantId })
      .from(entry)
      .where(inArray(entry.merchantId, ids));

    const named = new Set([...ruled, ...paid].map((row) => row.id));
    const aliasesOf = new Map<string, Array<string>>();

    for (const row of aliases) {
      aliasesOf.set(row.merchantId, [...(aliasesOf.get(row.merchantId) ?? []), row.alias]);
    }

    for (const row of merchants) {
      const own = aliasesOf.get(row.id) ?? [];

      const untouched =
        own.length > 0 &&
        own.every((alias) => stale.has(alias)) &&
        own.some((alias) => merchantName(alias) === row.name) &&
        row.defaultCategoryId === null &&
        !row.intermediary &&
        row.updatedAt.getTime() === row.createdAt.getTime() &&
        !named.has(row.id);

      if (untouched) {
        forgotten.push(row.id);
      }
    }
  }

  let deleted = 0;

  for (const part of chunked(forgotten)) {
    const rows = await transaction
      .delete(merchant)
      .where(
        and(
          inArray(merchant.id, [...part]),
          sql`${merchant.defaultCategoryId} is null`,
          eq(merchant.isIntermediary, false),
          sql`${merchant.updatedAt} = ${merchant.createdAt}`,
        ),
      )
      .returning({ id: merchant.id });

    deleted += rows.length;
  }

  return deleted;
}

/**
 * Reads `owner`'s merchants again (#194), what the app does once at every boot: merges, once per
 * user, those made one per town of a shop that the user never touched (#193,
 * `mergeTownMerchantsIn`, in a transaction of its own that marks the user); then forgets those made
 * from an operation prefix that the user never touched (`forgetOperationMerchantsIn`), and
 * recognises the merchant of every line whose cleaned label names none yet, in one transaction.
 */
export const rereadMerchants = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    const merged = yield* userData
      .mergingTownMerchants(owner, (transaction) => mergeTownMerchantsIn(transaction))
      .pipe(Effect.map(Option.getOrElse(() => 0)));

    return yield* userData.transaction(owner, async (transaction): Promise<Reread> => {
      await takeCategoryTurn(transaction, owner);

      const forgotten = await forgetOperationMerchantsIn(transaction);
      const recognised = await recogniseIn(transaction, owner);

      return { ...recognised, forgotten, merged };
    });
  });
