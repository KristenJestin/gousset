import {
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Result } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { LineNotFound } from "../errors";
import { isId } from "../imports/rows";
import { targetOf } from "../rules/effect";
import { LineMerchantRefused } from "./errors";
import { merchantKey } from "./labels";

// A line's merchant, and who was paid behind an intermediary (#30; docs/data-model.md, v0.3). The
// intermediary is read from the label as a line's merchant is (its cleaned label's merchant, marked
// as one), so nothing follows marks, merges or moved labels; who was paid is the line's entry's
// `merchant_id`, which a rule or the user sets.

/** A merchant as a line names it. */
export type NamedMerchant = { readonly id: string; readonly name: string };

/** Who a line paid, and through whom. */
export type LineMerchant = {
  /**
   * Who was paid: its entry's merchant (a rule's or the user's), else its label's when that is no
   * intermediary; null for none known.
   */
  readonly merchant: NamedMerchant | null;
  /** The intermediary its label names, when it names one. */
  readonly intermediary: NamedMerchant | null;
  /**
   * Who was paid is asked of the user: the label names an intermediary, no merchant is set, and the
   * line is one entry of its own that a merchant can be set on.
   */
  readonly asks: boolean;
};

/** Who was paid, set on a line. */
export type LineMerchantAssigned = {
  readonly merchant: NamedMerchant;
  /** The merchant was made for it: none had the name. */
  readonly created: boolean;
  /**
   * The merchant's default category, which the entry went in as it was not classified yet; null
   * when its category stayed as it was.
   */
  readonly category: LineCategory | null;
};

type LabelMerchant = NamedMerchant & { readonly intermediary: boolean };

/** The line's one entry made of the whole line, as rules classify it; undefined for none. */
type WholeEntry = {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly categoryId: string;
  readonly merchantId: string | null;
  readonly classifiedBy: "default" | "rule" | "user";
  readonly ruleId: string | null;
};

type LineFacts = {
  readonly labelMerchant: LabelMerchant | undefined;
  /** The merchant of its entry when it has exactly one, else null. */
  readonly entryMerchant: NamedMerchant | null;
  readonly whole: WholeEntry | undefined;
};

const entryMerchant = alias(merchant, "entry_merchant");

/** What a line's merchant is read from; undefined for no line of the user's. */
async function factsOf(
  transaction: UserTransaction,
  lineId: string,
  lock: boolean,
): Promise<LineFacts | undefined> {
  if (!isId(lineId)) {
    return undefined;
  }

  const [line] = await transaction
    .select({
      id: statementLine.id,
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
      state: statementLine.state,
    })
    .from(statementLine)
    .where(eq(statementLine.id, lineId));

  if (line === undefined) {
    return undefined;
  }

  const key = merchantKey(line.label, line.counterpartyName);

  const [named] =
    key === null
      ? []
      : await transaction
          .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
          .from(merchantAlias)
          .innerJoin(merchant, eq(merchant.id, merchantAlias.merchantId))
          .where(eq(merchantAlias.alias, key));

  const query = transaction
    .select({
      id: entry.id,
      kind: entry.kind,
      categoryId: entry.categoryId,
      merchantId: entry.merchantId,
      merchantName: entryMerchant.name,
      classifiedBy: entry.classifiedBy,
      ruleId: entry.ruleId,
      role: entryPart.role,
      parts:
        sql<number>`(select count(*) from ${entryPart} o where o.entry_id = ${entry.id})`.mapWith(
          Number,
        ),
    })
    .from(entryPart)
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .leftJoin(entryMerchant, eq(entryMerchant.id, entry.merchantId))
    .where(eq(entryPart.lineId, line.id));

  const entries = lock ? await query.for("update", { of: entry }) : await query;
  const [only] = entries;
  const one = entries.length === 1 ? only : undefined;

  return {
    labelMerchant: named,
    entryMerchant:
      one?.merchantId === null || one?.merchantId === undefined || one.merchantName === null
        ? null
        : { id: one.merchantId, name: one.merchantName },
    whole:
      line.state === "counted" && one !== undefined && one.parts === 1 && one.role === "payment"
        ? one
        : undefined,
  };
}

function merchantOf(facts: LineFacts): LineMerchant {
  const named = facts.labelMerchant;
  const intermediary = named?.intermediary === true ? { id: named.id, name: named.name } : null;

  const paid =
    facts.entryMerchant ??
    (named === undefined || named.intermediary ? null : { id: named.id, name: named.name });

  return {
    merchant: paid,
    intermediary,
    asks: intermediary !== null && paid === null && facts.whole !== undefined,
  };
}

/** The line's merchant and intermediary, in `owner`'s transaction; undefined for no such line. */
export async function lineMerchantIn(
  transaction: UserTransaction,
  lineId: string,
): Promise<LineMerchant | undefined> {
  const facts = await factsOf(transaction, lineId, false);

  return facts === undefined ? undefined : merchantOf(facts);
}

const parentCategory = alias(category, "parent");

/** The merchant's default category, when it is one the entry can go in: its kind, not archived. */
async function defaultCategoryFor(
  transaction: UserTransaction,
  merchantId: string,
  whole: WholeEntry,
): Promise<LineCategory | null> {
  const [row] = await transaction
    .select({
      id: category.id,
      name: category.name,
      parentName: parentCategory.name,
      kind: category.kind,
      archivedAt: category.archivedAt,
    })
    .from(merchant)
    .innerJoin(category, eq(category.id, merchant.defaultCategoryId))
    .leftJoin(parentCategory, eq(parentCategory.id, category.parentId))
    .where(eq(merchant.id, merchantId));

  if (row === undefined) {
    return null;
  }

  // A merchant alone brings its default category as a rule's does (`targetOf`).
  const target = targetOf({ setMerchantId: merchantId, setCategoryId: null }, whole, {
    categories: new Map([[row.id, { kind: row.kind, archived: row.archivedAt !== null }]]),
    defaults: new Map([[merchantId, row.id]]),
  });

  return target?.categoryId === row.id && row.id !== whole.categoryId
    ? { id: row.id, name: row.name, parentName: row.parentName, kind: row.kind }
    : null;
}

type Refusal = LineNotFound | LineMerchantRefused;

/**
 * Sets who was paid on an intermediary's line, in `owner`'s transaction: the merchant named `name`
 * (any case, trimmed already), made when none has it. The entry is then the user's (`classified_by = user`, no
 * rule), and goes in the merchant's default category when it was not classified yet.
 */
export async function assignLineMerchantIn(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  name: string,
): Promise<Result.Result<LineMerchantAssigned, Refusal>> {
  // A default category read here stays as it is until this commits.
  await takeCategoryTurn(transaction, owner);

  const facts = await factsOf(transaction, lineId, true);

  if (facts === undefined) {
    return Result.fail(new LineNotFound({ lineId }));
  }

  if (facts.labelMerchant?.intermediary !== true) {
    return Result.fail(new LineMerchantRefused({ lineId, reason: "not_intermediary" }));
  }

  const whole = facts.whole;

  if (whole === undefined) {
    return Result.fail(new LineMerchantRefused({ lineId, reason: "not_one_entry" }));
  }

  const byName = () =>
    transaction
      .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
      .from(merchant)
      .where(sql`lower(${merchant.name}) = lower(${name})`)
      .limit(1);

  const [existing] = await byName();

  if (existing?.intermediary === true) {
    return Result.fail(new LineMerchantRefused({ lineId, reason: "intermediary_chosen" }));
  }

  const inserted =
    existing === undefined
      ? await transaction
          .insert(merchant)
          .values({ userId: owner, name })
          .onConflictDoNothing({ target: [merchant.userId, merchant.name] })
          .returning({ id: merchant.id, name: merchant.name })
      : [];

  // A merchant of that name another transaction made meanwhile is found again.
  const [made] = inserted;
  const paid = existing ?? made ?? (await byName())[0];

  if (paid === undefined) {
    throw new Error("The merchant just made could not be read back.");
  }

  const moved =
    whole.classifiedBy === "default" ? await defaultCategoryFor(transaction, paid.id, whole) : null;

  await transaction
    .update(entry)
    .set({
      merchantId: paid.id,
      classifiedBy: "user",
      ruleId: null,
      categoryId: moved?.id ?? whole.categoryId,
    })
    .where(eq(entry.id, whole.id));

  return Result.succeed({
    merchant: { id: paid.id, name: paid.name },
    created: made !== undefined,
    category: moved,
  });
}
