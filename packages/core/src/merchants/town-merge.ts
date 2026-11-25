import { entry, merchant, merchantAlias, rule, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { compactOf, merchantName, nameKey } from "./labels";
import { shopsOfLines } from "./towns";

// The merchants made one per town before a card label's town was dropped (#193; docs/data-model.md,
// v0.3, "A card label's town"), merged once at every boot where the town rule is sure: "Pizza Nova
// Riverton" and "Pizza Nova Lakeside", which the user never touched, become one "Pizza Nova". What
// the user changed stays as it is.

/** A merchant as the merge reads it. */
type Held = {
  readonly id: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  /** Never changed by the user: see `mergeTownMerchantsIn`. */
  readonly untouched: boolean;
};

/** What one shop's merchants become: the one kept, its new name if any, the ones merged into it. */
type Plan = {
  readonly target: Held;
  readonly name: string | undefined;
  readonly merged: ReadonlyArray<Held>;
};

/** How many ids one query names. */
const CHUNK = 500;

function chunked<T>(items: ReadonlyArray<T>): ReadonlyArray<ReadonlyArray<T>> {
  return Array.from({ length: Math.ceil(items.length / CHUNK) }, (_chunk, index) =>
    items.slice(index * CHUNK, (index + 1) * CHUNK),
  );
}

/**
 * What each shop's merchants become: those of one shop are the merchants that have a cleaned label
 * of it, with its town or without, and the one named after it. The one named after it is kept, and
 * none when several are; else the first untouched one, renamed after the shop. The untouched others
 * go into it. A merchant of two shops' is left to the first.
 */
function plansOf(
  held: ReadonlyArray<Held>,
  shops: ReadonlyMap<string, string>,
  formOf: (alias: string) => string,
): ReadonlyArray<Plan> {
  const membersOf = new Map<string, Array<Held>>();

  for (const each of held) {
    const forms = new Set([...each.aliases.map(formOf), compactOf(nameKey(each.name))]);

    for (const form of forms) {
      if (shops.has(form)) {
        const members = membersOf.get(form) ?? [];

        members.push(each);
        membersOf.set(form, members);
      }
    }
  }

  const used = new Set<string>();
  const plans: Array<Plan> = [];
  const names = new Set(held.map((each) => each.name.toLowerCase()));

  for (const [form, shop] of [...shops].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const members = (membersOf.get(form) ?? []).toSorted((a, b) => (a.id < b.id ? -1 : 1));

    if (members.some((each) => used.has(each.id))) {
      continue;
    }

    const named = members.filter((each) => compactOf(nameKey(each.name)) === form);

    const untouched = members.filter(
      (each) => each.untouched && each.aliases.every((alias) => formOf(alias) === form),
    );

    const target = named.length > 1 ? undefined : (named[0] ?? untouched[0]);

    if (target === undefined) {
      continue;
    }

    const name = named.length === 0 ? merchantName(shop) : undefined;
    const merged = untouched.filter((each) => each.id !== target.id);

    if (
      (name === undefined && merged.length === 0) ||
      (name !== undefined && names.has(name.toLowerCase()))
    ) {
      continue;
    }

    for (const each of [target, ...merged]) {
      used.add(each.id);
    }

    if (name !== undefined) {
      names.add(name.toLowerCase());
    }

    plans.push({ target, name, merged });
  }

  return plans;
}

/**
 * Merges, in `owner`'s transaction, the merchants made one per town of a shop's card labels (#193,
 * `./towns`): those the user never touched go into one, named after the shop. A merchant is
 * untouched when every cleaned label it has is of that shop, it has the name recognition gave it
 * (from one of them, with its town or without), no default category, is no intermediary, was never
 * changed (a rename, a mark, a merge into it), and no rule nor entry names it. The one kept is the
 * merchant named after the shop when there is one (whatever the user did to it), else the first
 * untouched one, renamed after the shop without being marked as changed. Any other is left as it is.
 * Gives how many merchants went into another. Safe to run again: a second run finds none.
 */
export async function mergeTownMerchantsIn(transaction: UserTransaction): Promise<number> {
  const labels = await transaction
    .selectDistinct({
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(statementLine)
    .where(ne(statementLine.state, "discarded"));

  const shopOf = shopsOfLines(labels);

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
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias);

  const ruled = await transaction
    .selectDistinct({ id: rule.setMerchantId })
    .from(rule)
    .where(isNotNull(rule.setMerchantId));

  const paid = await transaction
    .selectDistinct({ id: entry.merchantId })
    .from(entry)
    .where(isNotNull(entry.merchantId));

  const named = new Set([...ruled, ...paid].map((row) => row.id));
  const aliasesOf = new Map<string, Array<string>>();

  for (const row of aliases) {
    const own = aliasesOf.get(row.merchantId) ?? [];

    own.push(row.alias);
    aliasesOf.set(row.merchantId, own);
  }

  const held = merchants.map((row): Held => {
    const own = aliasesOf.get(row.id) ?? [];

    const untouched =
      own.length > 0 &&
      own.some(
        (alias) =>
          merchantName(alias) === row.name || merchantName(shopOf.get(alias) ?? alias) === row.name,
      ) &&
      row.defaultCategoryId === null &&
      !row.intermediary &&
      row.updatedAt.getTime() === row.createdAt.getTime() &&
      !named.has(row.id);

    return { id: row.id, name: row.name, aliases: own, untouched };
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
