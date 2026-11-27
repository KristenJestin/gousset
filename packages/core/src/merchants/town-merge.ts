import { entry, merchant, merchantAlias, rule, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { conditionMerchantsIn } from "../rules/rules";
import { compactOf, merchantName } from "./labels";
import { sureShopsOfLines } from "./towns";

// The merchants made one per town before a card label's town was dropped (#193; docs/data-model.md,
// v0.3, "The merchants made one per town are merged"), merged once per user, at the first boot after
// the update, on the towns the rule is sure of: "Pizza Nova Riverton" and "Pizza Nova Lakeside",
// which the user never touched, become one "Pizza Nova". What the user changed stays as it is.

/** A merchant as the merge reads it. */
export type Held = {
  readonly id: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  /** Recognition made it and the user never changed it (`isUntouched`). */
  readonly untouched: boolean;
};

/** What one shop's merchants become: the one kept, its new name if any, the ones merged into it. */
export type Plan = {
  readonly target: Held;
  readonly name: string | undefined;
  readonly merged: ReadonlyArray<Held>;
};

/** A merchant's row, as `isUntouched` reads it. */
export type MerchantRow = {
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly defaultCategoryId: string | null;
  readonly intermediary: boolean;
};

/** One of a merchant's cleaned labels, and when it was written. */
export type AliasRow = { readonly alias: string; readonly createdAt: Date };

/** How many ids one query names. */
const CHUNK = 500;

function chunked<T>(items: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  return Array.from({ length: Math.ceil(items.length / CHUNK) }, (_chunk, index) =>
    items.slice(index * CHUNK, (index + 1) * CHUNK),
  );
}

/**
 * Whether recognition made the merchant and the user never changed it. Recognition writes a
 * merchant with a cleaned label of its, in one transaction (both `created_at` the same), and names
 * it from that label, its town kept (before #193) or dropped (`shopOf`). Any other is the user's: one
 * a split made (its cleaned labels written before it, whatever its name), one renamed, merged into,
 * split from or marked (`updated_at` moved), one with a default category, an intermediary, one a
 * rule (what it sets or a condition) or an entry names (`named`), one with no cleaned label.
 */
export function isUntouched(
  row: MerchantRow,
  aliases: ReadonlyArray<AliasRow>,
  shopOf: ReadonlyMap<string, string>,
  named: boolean,
): boolean {
  const recognised =
    aliases.some((each) => each.createdAt.getTime() === row.createdAt.getTime()) &&
    aliases.some(
      ({ alias }) =>
        merchantName(alias) === row.name || merchantName(shopOf.get(alias) ?? alias) === row.name,
    );

  return (
    recognised &&
    row.defaultCategoryId === null &&
    !row.intermediary &&
    row.updatedAt.getTime() === row.createdAt.getTime() &&
    !named
  );
}

/**
 * What each shop's merchants become. Only the untouched ones whose every cleaned label is of the shop
 * (`formOf`, its town dropped or none) count, and only when there are two or more: one alone is never
 * renamed. They go into the one already named after the shop, else into the first, renamed after
 * it; when a merchant of the user's holds that name, nothing moves. A merchant the user changed is
 * never touched, nor taken into.
 */
export function plansOf(
  held: ReadonlyArray<Held>,
  shops: ReadonlyMap<string, string>,
  formOf: (alias: string) => string,
): ReadonlyArray<Plan> {
  const membersOf = new Map<string, Array<Held>>();

  for (const each of held) {
    const [form] = new Set(each.aliases.map(formOf));

    if (
      each.untouched &&
      form !== undefined &&
      shops.has(form) &&
      each.aliases.every((alias) => formOf(alias) === form)
    ) {
      const members = membersOf.get(form) ?? [];

      members.push(each);
      membersOf.set(form, members);
    }
  }

  const plans: Array<Plan> = [];
  const names = new Set(held.map((each) => each.name.toLowerCase()));

  for (const [form, shop] of [...shops].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const members = (membersOf.get(form) ?? []).toSorted((a, b) => (a.id < b.id ? -1 : 1));
    const shopName = merchantName(shop);
    const named = members.find((each) => each.name === shopName);
    const target = named ?? members[0];

    if (members.length < 2 || target === undefined) {
      continue;
    }

    const name = named === undefined ? shopName : undefined;

    if (name !== undefined && names.has(name.toLowerCase())) {
      continue;
    }

    if (name !== undefined) {
      names.add(name.toLowerCase());
    }

    plans.push({ target, name, merged: members.filter((each) => each.id !== target.id) });
  }

  return plans;
}

/**
 * Merges, in `owner`'s transaction, the merchants made one per town of a shop's card labels (#193):
 * on the towns the rule is sure of (`sureShopsOfLines`), the untouched merchants of one shop
 * (`isUntouched`, `plansOf`) go into one, named after the shop without being marked as changed.
 * Any other is left as it is. Gives how many merchants went into another. The boot runs it once per
 * user (`UserData.mergingTownMerchants`); run again, it finds none.
 */
export async function mergeTownMerchantsIn(transaction: UserTransaction): Promise<number> {
  const labels = await transaction
    .selectDistinct({
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(statementLine)
    .where(ne(statementLine.state, "discarded"));

  const shopOf = sureShopsOfLines(labels);

  if (shopOf.size === 0) {
    return 0;
  }

  const shops = new Map([...shopOf.values()].toSorted().map((shop) => [compactOf(shop), shop]));
  const formOf = (alias: string) => compactOf(shopOf.get(alias) ?? alias);

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
    .for("update");

  const aliases = await transaction
    .select({
      alias: merchantAlias.alias,
      merchantId: merchantAlias.merchantId,
      createdAt: merchantAlias.createdAt,
    })
    .from(merchantAlias);

  const ruled = await transaction
    .selectDistinct({ id: rule.setMerchantId })
    .from(rule)
    .where(isNotNull(rule.setMerchantId));

  const paid = await transaction
    .selectDistinct({ id: entry.merchantId })
    .from(entry)
    .where(isNotNull(entry.merchantId));

  // A condition names a merchant by its id inside the rule's JSON, which no foreign key follows
  // (#37): one a condition names is the user's, never merged away.
  const conditioned = await conditionMerchantsIn(transaction);
  const named = new Set([...[...ruled, ...paid].map((row) => row.id), ...conditioned]);
  const aliasesOf = new Map<string, Array<AliasRow>>();

  for (const row of aliases) {
    const own = aliasesOf.get(row.merchantId) ?? [];

    own.push({ alias: row.alias, createdAt: row.createdAt });
    aliasesOf.set(row.merchantId, own);
  }

  const held = merchants.map((row): Held => {
    const own = aliasesOf.get(row.id) ?? [];

    return {
      id: row.id,
      name: row.name,
      aliases: own.map((each) => each.alias),
      untouched: isUntouched(row, own, shopOf, named.has(row.id)),
    };
  });

  let merged = 0;

  for (const plan of plansOf(held, shops, formOf)) {
    const ids = plan.merged.map((each) => each.id);

    for (const part of chunked(ids)) {
      await transaction
        .update(merchantAlias)
        .set({ merchantId: plan.target.id })
        .where(inArray(merchantAlias.merchantId, [...part]));

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

      merged += rows.length;
    }

    if (plan.name !== undefined) {
      // The boot's own rename, not the user's: the merchant stays as never changed.
      await transaction
        .update(merchant)
        .set({ name: plan.name, updatedAt: sql`${merchant.updatedAt}` })
        .where(eq(merchant.id, plan.target.id));
    }
  }

  return merged;
}
