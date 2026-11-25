import {
  category,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Result } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { LineNotFound } from "../errors";
import { isId } from "../imports/rows";
import { lookOf } from "../look";
import type { Look } from "../look";
import { targetOf } from "../rules/effect";
import { LineMerchantRefused } from "./errors";
import { merchantKey } from "./labels";
import { logoShaOf } from "./look-columns";

// A line's merchant, and who was paid behind an intermediary (#30; docs/data-model.md, v0.3). The
// intermediary is read from the label as a line's merchant is (its cleaned label's merchant, marked
// as one), so nothing follows marks, merges or moved labels; who was paid is the line's entry's
// `merchant_id`, which a rule or the user sets. An intermediary is never who was paid: an entry's
// merchant that is one (a mark or a merge after it was set) counts as none, and the line asks.

/** A merchant as a line names it, with how it is shown (#204). */
export type NamedMerchant = { readonly id: string; readonly name: string; readonly look: Look };

const lookColumns = { color: merchant.color, logoSha: logoShaOf(merchant.id) };

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
  /** The merchant of its entry when it has exactly one and that is no intermediary, else null. */
  readonly entryMerchant: NamedMerchant | null;
  readonly whole: WholeEntry | undefined;
};

const entryMerchant = alias(merchant, "entry_merchant");

const entryLook = {
  merchantColor: entryMerchant.color,
  merchantLogoSha: logoShaOf(entryMerchant.id),
};

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

  const [found] =
    key === null
      ? []
      : await transaction
          .select({
            id: merchant.id,
            name: merchant.name,
            intermediary: merchant.isIntermediary,
            ...lookColumns,
          })
          .from(merchantAlias)
          .innerJoin(merchant, eq(merchant.id, merchantAlias.merchantId))
          .where(eq(merchantAlias.alias, key));

  const named =
    found === undefined
      ? undefined
      : {
          id: found.id,
          name: found.name,
          intermediary: found.intermediary,
          look: lookOf(found.color, found.logoSha),
        };

  const query = transaction
    .select({
      id: entry.id,
      kind: entry.kind,
      categoryId: entry.categoryId,
      merchantId: entry.merchantId,
      merchantName: entryMerchant.name,
      merchantIntermediary: entryMerchant.isIntermediary,
      ...entryLook,
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
      one?.merchantId === null ||
      one?.merchantId === undefined ||
      one.merchantName === null ||
      one.merchantIntermediary !== false
        ? null
        : {
            id: one.merchantId,
            name: one.merchantName,
            look: lookOf(one.merchantColor, one.merchantLogoSha),
          },
    whole:
      line.state === "counted" && one !== undefined && one.parts === 1 && one.role === "payment"
        ? one
        : undefined,
  };
}

function merchantOf(facts: LineFacts): LineMerchant {
  const named = facts.labelMerchant;

  const intermediary =
    named?.intermediary === true ? { id: named.id, name: named.name, look: named.look } : null;

  const paid =
    facts.entryMerchant ??
    (named === undefined || named.intermediary
      ? null
      : { id: named.id, name: named.name, look: named.look });

  return {
    merchant: paid,
    intermediary,
    asks: intermediary !== null && paid === null && facts.whole !== undefined,
  };
}

/** A line as `merchantsOfLines` reads it. */
type NamingLine = {
  readonly id: string;
  readonly label: string;
  readonly counterpartyName: string | null;
};

/**
 * Who each line paid, as `LineMerchant.merchant` says it, with its look (#204): for a page of the
 * operations list, in two queries whatever its length. A line whose merchant is none known is left
 * out.
 */
export async function merchantsOfLines(
  transaction: UserTransaction,
  lines: ReadonlyArray<NamingLine>,
): Promise<ReadonlyMap<string, NamedMerchant>> {
  if (lines.length === 0) {
    return new Map();
  }

  const keyOf = new Map(
    lines.map((line) => [line.id, merchantKey(line.label, line.counterpartyName)]),
  );

  const keys = [...new Set([...keyOf.values()].flatMap((key) => (key === null ? [] : [key])))];

  const named =
    keys.length === 0
      ? []
      : await transaction
          .select({
            alias: merchantAlias.alias,
            id: merchant.id,
            name: merchant.name,
            intermediary: merchant.isIntermediary,
            ...lookColumns,
          })
          .from(merchantAlias)
          .innerJoin(merchant, eq(merchant.id, merchantAlias.merchantId))
          .where(inArray(merchantAlias.alias, keys));

  const byAlias = new Map(named.map((row) => [row.alias, row]));

  const parts = await transaction
    .selectDistinct({
      lineId: entryPart.lineId,
      entryId: entry.id,
      merchantId: entryMerchant.id,
      merchantName: entryMerchant.name,
      merchantIntermediary: entryMerchant.isIntermediary,
      ...entryLook,
    })
    .from(entryPart)
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .leftJoin(entryMerchant, eq(entryMerchant.id, entry.merchantId))
    .where(
      inArray(
        entryPart.lineId,
        lines.map((line) => line.id),
      ),
    );

  const entriesOf = new Map<string, Array<(typeof parts)[number]>>();

  for (const part of parts) {
    const known = entriesOf.get(part.lineId);

    if (known === undefined) {
      entriesOf.set(part.lineId, [part]);
    } else {
      known.push(part);
    }
  }

  const merchants = new Map<string, NamedMerchant>();

  for (const line of lines) {
    const [only, ...others] = entriesOf.get(line.id) ?? [];
    const key = keyOf.get(line.id);
    const label = key === null || key === undefined ? undefined : byAlias.get(key);

    // Its one entry's merchant, when it is no intermediary, as `factsOf` reads it.
    const own =
      only === undefined ||
      others.length > 0 ||
      only.merchantId === null ||
      only.merchantName === null ||
      only.merchantIntermediary !== false
        ? undefined
        : {
            id: only.merchantId,
            name: only.merchantName,
            look: lookOf(only.merchantColor, only.merchantLogoSha),
          };

    const paid =
      own ??
      (label === undefined || label.intermediary
        ? undefined
        : { id: label.id, name: label.name, look: lookOf(label.color, label.logoSha) });

    if (paid !== undefined) {
      merchants.set(line.id, paid);
    }
  }

  return merchants;
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
      .select({
        id: merchant.id,
        name: merchant.name,
        intermediary: merchant.isIntermediary,
        ...lookColumns,
      })
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
          .returning({ id: merchant.id, name: merchant.name, ...lookColumns })
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
    merchant: { id: paid.id, name: paid.name, look: lookOf(paid.color, paid.logoSha) },
    created: made !== undefined,
    category: moved,
  });
}
