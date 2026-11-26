import {
  account,
  category,
  entry,
  merchant,
  merchantAlias,
  rule,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { and, asc, count, desc, eq, exists, gt, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias as aliasOf } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Result } from "effect";

import type { LineCategory } from "../category-store";
import { takeCategoryTurn } from "../category-turn";
import { LineNotFound } from "../errors";
import { isId } from "../imports/rows";
import { classifyByMerchants } from "./default-classification";
import { isKnownIntermediary } from "./intermediaries";
import { assignLineMerchantIn, lineMerchantIn } from "./line-merchant";
import type { LineMerchant, LineMerchantAssigned } from "./line-merchant";
import type { Money } from "../month";
import { today } from "../today";
import type { LineMerchantRefused } from "./errors";
import {
  MerchantAliasNotFound,
  MerchantMergeRefused,
  MerchantNameRefused,
  MerchantNameTaken,
  MerchantNameUnknown,
  MerchantNotFound,
} from "./errors";
import { MAX_KEY_LENGTH, assignMerchants, merchantKey, nameKey } from "./labels";
import type { KnownKey } from "./labels";

// The merchants (#24): who was paid, recognised from the lines' raw labels (`./labels`), each
// user's own, renamed, merged and split by the user. A line is a merchant's when its label cleans
// to one of the merchant's aliases; the line itself is never changed (docs/data-model.md, v0.3).
// A merchant may have a default category (#23), which a merge of categories moves and archiving
// keeps (`../categories`, `setMerchantDefaultCategory` sets it).

/**
 * The longest name a merchant may have, once trimmed: the longest a key may be, so that a merchant
 * recognised from a long label can be renamed as it is, and named as a move's target.
 */
export const MAX_MERCHANT_NAME = MAX_KEY_LENGTH;

/** How many merchants a page lists when none is asked for, and the most. */
export const DEFAULT_MERCHANTS_LISTED = 100;
export const MAX_MERCHANTS_LISTED = 500;

/**
 * How many of the newest lines a merchant's page reads to find its own, and how many it shows. A
 * line's merchant is read from its label, cleaned in code, not stored: the page reads the latest
 * lines and keeps the merchant's.
 */
export const MERCHANT_LINES_SCANNED = 5000;
export const MERCHANT_LINES_SHOWN = 20;

/** A merchant as a list gives it. */
export type MerchantSummary = {
  readonly id: string;
  readonly name: string;
  /** How many cleaned labels name it. */
  readonly aliases: number;
  /** A payment intermediary (#30): its lines' labels hide who was paid. */
  readonly intermediary: boolean;
};

/** What a list of the merchants asks for; every field may be left out. */
export type MerchantSearch = {
  /** A piece of the name or of a cleaned label, any case, accents aside. Blank for none. */
  readonly text?: string;
  /** The `next` of the page before. */
  readonly after?: string;
  /** How many merchants: 100 by default, 1 to 500. */
  readonly limit?: number;
};

/** A page of merchants, by name. */
export type MerchantPage = {
  readonly merchants: ReadonlyArray<MerchantSummary>;
  /** Give it as `after` for the next page; null on the last one. */
  readonly next: string | null;
  /** How many merchants match in all, whatever the page. */
  readonly total: number;
};

/** A line paid to (or by) a merchant. */
export type MerchantLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly label: string;
  readonly amount: Money;
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly institution: string | null;
  };
};

/** A merchant's default category, archived or not: it keeps one archived after it was chosen. */
export type MerchantDefaultCategory = LineCategory & { readonly archived: boolean };

/** A merchant with all that names it, and its latest lines. */
export type MerchantDetail = {
  readonly id: string;
  readonly name: string;
  /** A payment intermediary (#30): its lines' labels hide who was paid. */
  readonly intermediary: boolean;
  /** The user said its payments are no subscription (#34): none is proposed for it. */
  readonly subscriptionDismissed: boolean;
  /** The category its entries go in by default; null for none. */
  readonly defaultCategory: MerchantDefaultCategory | null;
  /** The cleaned labels that name it, in alphabetical order. */
  readonly aliases: ReadonlyArray<string>;
  /** Its latest counted lines, newest first, among the `MERCHANT_LINES_SCANNED` newest lines. */
  readonly lines: ReadonlyArray<MerchantLine>;
};

/** What a recognition added. */
export type Recognised = { readonly merchants: number; readonly aliases: number };

/** A cleaned label moved to another merchant: the one it left, the one it went to. */
export type AliasMoved = {
  readonly alias: string;
  readonly from: MerchantSummary;
  readonly to: MerchantSummary;
  /** The merchant it went to was made for it. */
  readonly created: boolean;
};

/** A merge done: the merchant kept, with what it took over. */
export type Merged = {
  readonly into: MerchantSummary;
  readonly merged: string;
  readonly aliasesMoved: number;
};

type Failure = QueryFailed;

/** The merchants, for the user `owner` of each call. */
export class Merchants extends Context.Service<
  Merchants,
  {
    /** The merchants by name, those whose name or a cleaned label contains `text` when given. */
    readonly list: (
      owner: string,
      query: {
        readonly text: string | null;
        readonly after: string | null;
        readonly limit: number;
      },
    ) => Effect.Effect<MerchantPage, Failure>;
    /** One merchant, its cleaned labels and its latest lines booked on or before `day`. */
    readonly show: (
      owner: string,
      merchantId: string,
      day: string,
    ) => Effect.Effect<MerchantDetail, MerchantNotFound | Failure>;
    /** The merchant of that name, in any case. */
    readonly named: (
      owner: string,
      name: string,
    ) => Effect.Effect<MerchantSummary, MerchantNameUnknown | Failure>;
    /** Renames it; refused when another merchant has the name. */
    readonly rename: (
      owner: string,
      merchantId: string,
      name: string,
    ) => Effect.Effect<
      MerchantSummary,
      MerchantNotFound | MerchantNameRefused | MerchantNameTaken | Failure
    >;
    /**
     * Moves a cleaned label of the merchant `merchantId` to the merchant named `to` (any case),
     * made when none has that name: how a merchant that joined two shops is split. Refused for a
     * cleaned label that is not that merchant's.
     */
    readonly moveAlias: (
      owner: string,
      merchantId: string,
      alias: string,
      to: string,
    ) => Effect.Effect<
      AliasMoved,
      MerchantNotFound | MerchantAliasNotFound | MerchantNameRefused | Failure
    >;
    /** Merges `merchantId` into `intoId`: its cleaned labels move, then it is deleted. */
    readonly merge: (
      owner: string,
      merchantId: string,
      intoId: string,
    ) => Effect.Effect<Merged, MerchantNotFound | MerchantMergeRefused | Failure>;
    /** Recognises the merchants of every line whose cleaned label names none yet. */
    readonly recognise: (owner: string) => Effect.Effect<Recognised, Failure>;
    /** Marks it a payment intermediary, or not (#30). */
    readonly markIntermediary: (
      owner: string,
      merchantId: string,
      intermediary: boolean,
    ) => Effect.Effect<MerchantSummary, MerchantNotFound | Failure>;
    /**
     * Says its payments are no subscription (`dismissed`), so that none of them is proposed again,
     * or takes it back (#34).
     */
    readonly markSubscription: (
      owner: string,
      merchantId: string,
      dismissed: boolean,
    ) => Effect.Effect<MerchantSummary, MerchantNotFound | Failure>;
    /** Who a line paid, through which intermediary, and whether the user is asked who (#30). */
    readonly ofLine: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<LineMerchant, LineNotFound | Failure>;
    /**
     * Sets who was paid on an intermediary's line: the merchant named `name` (any case), made when
     * none has it. Refused for a line whose label names no intermediary, one that is not one entry
     * of the whole line, or an intermediary named as who was paid.
     */
    readonly assignLine: (
      owner: string,
      lineId: string,
      name: string,
    ) => Effect.Effect<
      LineMerchantAssigned,
      LineNotFound | LineMerchantRefused | MerchantNameRefused | Failure
    >;
  }
>()("@gousset/core/Merchants") {}

/** How many rows one insert writes. */
const CHUNK = 500;

/** `%`, `_` and `\` are themselves in a search, not `like`'s wildcards. */
const substring = (text: string) => `%${text.replaceAll(/[\\%_]/g, String.raw`\$&`)}%`;

/** A text as cleaned labels are written: upper case, accents removed, spaces collapsed. */
const asAlias = (text: string) =>
  text.normalize("NFKD").replaceAll(/\p{M}/gu, "").toUpperCase().replaceAll(/\s+/g, " ").trim();

const aliasCount = sql<number>`(select count(*)::int from ${merchantAlias} where ${merchantAlias.merchantId} = ${merchant.id})`;

const summaryColumns = {
  id: merchant.id,
  name: merchant.name,
  aliases: aliasCount,
  intermediary: merchant.isIntermediary,
};

/**
 * Recognises, in a transaction of `owner`'s, the merchant of every line (counted or held) whose
 * cleaned label names none yet: an existing merchant when the label matches one of its names, a
 * new one otherwise (`assignMerchants`). A cleaned label already known is never moved: what the
 * user split or merged stays. The entries of the lines it gave a merchant then go in that
 * merchant's default category (`./default-classification`). Safe to run at once in two
 * transactions, and again: a row the other added first is kept. It takes the user's turn first
 * (`../category-turn`), so that a default set meanwhile waits for it, or it for the default.
 */
export async function recogniseIn(
  transaction: UserTransaction,
  owner: string,
): Promise<Recognised> {
  await takeCategoryTurn(transaction, owner);

  const labels = await transaction
    .selectDistinct({
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
    })
    .from(statementLine)
    .where(ne(statementLine.state, "discarded"));

  const aliases = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias);

  const aliased = new Set(aliases.map((row) => row.alias));
  const keys = new Set<string>();

  for (const row of labels) {
    const key = merchantKey(row.label, row.counterpartyName);

    if (key !== null && !aliased.has(key)) {
      keys.add(key);
    }
  }

  // With no new cleaned label the entries are still classified: an operation's mark (#194), set
  // by a migration, moves an entry of no merchant.
  if (keys.size === 0) {
    await classifyByMerchants(transaction, { every: true });

    return { merchants: 0, aliases: 0 };
  }

  const merchants = await transaction
    .select({ id: merchant.id, name: merchant.name, intermediary: merchant.isIntermediary })
    .from(merchant);

  // An intermediary's keys match only exactly (#30): `LYDIA MARTIN` is not paid through Lydia.
  const marked = new Set(merchants.flatMap((row) => (row.intermediary ? [row.id] : [])));

  const known: Array<KnownKey> = aliases.map((row) => ({
    key: row.alias,
    merchantId: row.merchantId,
    intermediary: marked.has(row.merchantId),
  }));

  for (const row of merchants) {
    const key = nameKey(row.name);

    if (key !== "") {
      known.push({ key, merchantId: row.id, intermediary: row.intermediary });
    }
  }

  const assigned = assignMerchants([...keys], known, isKnownIntermediary);
  const names = new Set<string>();
  // A merchant made from a known intermediary's cleaned label is one (#30).
  const intermediaries = new Set<string>();

  for (const assignment of assigned) {
    if ("name" in assignment.merchant) {
      names.add(assignment.merchant.name);

      if (isKnownIntermediary(assignment.alias)) {
        intermediaries.add(assignment.merchant.name);
      }
    }
  }

  const newNames = [...names];
  const idOfName = new Map<string, string>();
  let made = 0;

  for (let start = 0; start < newNames.length; start += CHUNK) {
    const chunk = newNames.slice(start, start + CHUNK);

    const inserted = await transaction
      .insert(merchant)
      .values(
        chunk.map((name) => ({ userId: owner, name, isIntermediary: intermediaries.has(name) })),
      )
      .onConflictDoNothing({ target: [merchant.userId, merchant.name] })
      .returning({ id: merchant.id });

    made += inserted.length;

    // A name another transaction made meanwhile is found again, and its merchant used.
    const named = await transaction
      .select({ id: merchant.id, name: merchant.name })
      .from(merchant)
      .where(inArray(merchant.name, chunk));

    for (const row of named) {
      idOfName.set(row.name, row.id);
    }
  }

  const rows = assigned.flatMap((assignment) => {
    const merchantId =
      "id" in assignment.merchant ? assignment.merchant.id : idOfName.get(assignment.merchant.name);

    return merchantId === undefined ? [] : [{ userId: owner, merchantId, alias: assignment.alias }];
  });

  let added = 0;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const inserted = await transaction
      .insert(merchantAlias)
      .values(rows.slice(start, start + CHUNK))
      .onConflictDoNothing({ target: [merchantAlias.userId, merchantAlias.alias] })
      .returning({ id: merchantAlias.id });

    added += inserted.length;
  }

  await classifyByMerchants(transaction, { every: true });

  return { merchants: made, aliases: added };
}

async function summaryById(
  transaction: UserTransaction,
  merchantId: string,
): Promise<MerchantSummary | undefined> {
  if (!isId(merchantId)) {
    return undefined;
  }

  const [row] = await transaction
    .select(summaryColumns)
    .from(merchant)
    .where(eq(merchant.id, merchantId));

  return row;
}

/** The merchant whose name is `name` in any case, but `except`. */
async function summaryByName(
  transaction: UserTransaction,
  name: string,
  except?: string,
): Promise<MerchantSummary | undefined> {
  const [row] = await transaction
    .select(summaryColumns)
    .from(merchant)
    .where(
      and(
        sql`lower(${merchant.name}) = lower(${name})`,
        except === undefined ? undefined : ne(merchant.id, except),
      ),
    )
    .limit(1);

  return row;
}

async function list(
  transaction: UserTransaction,
  query: { readonly text: string | null; readonly after: string | null; readonly limit: number },
): Promise<MerchantPage> {
  const text = query.text;

  const matches =
    text === null
      ? undefined
      : or(
          sql`${merchant.name} ilike ${substring(text)}`,
          exists(
            transaction
              .select({ one: sql`1` })
              .from(merchantAlias)
              .where(
                and(
                  eq(merchantAlias.merchantId, merchant.id),
                  sql`${merchantAlias.alias} ilike ${substring(asAlias(text))}`,
                ),
              ),
          ),
        );

  const rows = await transaction
    .select(summaryColumns)
    .from(merchant)
    .where(and(matches, query.after === null ? undefined : gt(merchant.name, query.after)))
    .orderBy(asc(merchant.name))
    .limit(query.limit + 1);

  const [counted] = await transaction.select({ total: count() }).from(merchant).where(matches);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);

  return {
    merchants: page,
    next: rows.length > query.limit && last !== undefined ? last.name : null,
    total: counted?.total ?? 0,
  };
}

async function show(
  transaction: UserTransaction,
  merchantId: string,
  day: string,
): Promise<MerchantDetail | undefined> {
  const found = await summaryById(transaction, merchantId);

  if (found === undefined) {
    return undefined;
  }

  const aliases = await transaction
    .select({ alias: merchantAlias.alias })
    .from(merchantAlias)
    .where(eq(merchantAlias.merchantId, found.id))
    .orderBy(asc(merchantAlias.alias));

  const names = new Set(aliases.map((row) => row.alias));
  const defaultCategory = await defaultCategoryOf(transaction, found.id);

  const [marks] = await transaction
    .select({ subscriptionDismissed: merchant.subscriptionDismissed })
    .from(merchant)
    .where(eq(merchant.id, found.id));

  const scanned =
    names.size === 0
      ? []
      : await transaction
          .select({
            id: statementLine.id,
            bookedOn: statementLine.bookedOn,
            label: statementLine.label,
            counterpartyName: statementLine.counterpartyName,
            amountMinor: statementLine.amountMinor,
            accountId: statementLine.accountId,
          })
          .from(statementLine)
          .where(and(eq(statementLine.state, "counted"), lte(statementLine.bookedOn, day)))
          .orderBy(desc(statementLine.bookedOn), desc(statementLine.id))
          .limit(MERCHANT_LINES_SCANNED);

  const own: Array<(typeof scanned)[number]> = [];

  for (const line of scanned) {
    const key = merchantKey(line.label, line.counterpartyName);

    if (key !== null && names.has(key)) {
      own.push(line);
    }

    if (own.length === MERCHANT_LINES_SHOWN) {
      break;
    }
  }

  const accounts =
    own.length === 0
      ? []
      : await transaction
          .select({
            id: account.id,
            name: account.name,
            institution: account.institution,
            currency: account.currency,
          })
          .from(account);

  const accountOf = new Map(accounts.map((row) => [row.id, row]));

  // Every line's account is the user's (a composite foreign key) and so among those just read.
  const lines = own.flatMap((line): Array<MerchantLine> => {
    const owned = accountOf.get(line.accountId);

    return owned === undefined
      ? []
      : [
          {
            id: line.id,
            bookedOn: line.bookedOn,
            label: line.label,
            amount: { minor: line.amountMinor, currency: owned.currency },
            account: { id: owned.id, name: owned.name, institution: owned.institution },
          },
        ];
  });

  return {
    id: found.id,
    name: found.name,
    intermediary: found.intermediary,
    subscriptionDismissed: marks?.subscriptionDismissed === true,
    defaultCategory,
    aliases: [...names],
    lines,
  };
}

const parentCategory = aliasOf(category, "parent");

/** The merchant's default category, with its parent's name; null for none. */
async function defaultCategoryOf(
  transaction: UserTransaction,
  merchantId: string,
): Promise<MerchantDefaultCategory | null> {
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

  const { archivedAt, ...shown } = row;

  return { ...shown, archived: archivedAt !== null };
}

/** A name as the user gave it, trimmed, or why it is refused. */
function nameOf(name: string): Result.Result<string, MerchantNameRefused> {
  const trimmed = name.trim().replaceAll(/\s+/g, " ");

  if (trimmed === "") {
    return Result.fail(new MerchantNameRefused({ reason: "blank" }));
  }

  return trimmed.length > MAX_MERCHANT_NAME
    ? Result.fail(new MerchantNameRefused({ reason: "too_long" }))
    : Result.succeed(trimmed);
}

/** `Merchants` on the database, through `UserData`. */
export const merchantsLayer = Layer.effect(
  Merchants,
  Effect.gen(function* () {
    const userData = yield* UserData;

    const inTransaction = <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
      userData.transaction(owner, work);

    return {
      list: (owner, query) => inTransaction(owner, (transaction) => list(transaction, query)),

      show: (owner, merchantId, day) =>
        inTransaction(owner, (transaction) => show(transaction, merchantId, day)).pipe(
          Effect.flatMap((found) =>
            found === undefined
              ? Effect.fail(new MerchantNotFound({ merchantId }))
              : Effect.succeed(found),
          ),
        ),

      named: (owner, name) =>
        inTransaction(owner, async (transaction) => {
          const found = await summaryByName(transaction, name.trim());

          if (found !== undefined) {
            return found;
          }

          const close = await transaction
            .select({ name: merchant.name })
            .from(merchant)
            .where(sql`${merchant.name} ilike ${substring(name.trim())}`)
            .orderBy(asc(merchant.name))
            .limit(5);

          return close.map((row) => row.name);
        }).pipe(
          Effect.flatMap((found) =>
            Array.isArray(found)
              ? Effect.fail(new MerchantNameUnknown({ name, close: found }))
              : Effect.succeed(found),
          ),
        ),

      rename: (owner, merchantId, name) =>
        Effect.gen(function* () {
          const wanted = yield* Effect.fromResult(nameOf(name));

          const renamed = yield* inTransaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<MerchantSummary, MerchantNotFound | MerchantNameTaken>> => {
              const found = await summaryById(transaction, merchantId);

              if (found === undefined) {
                return Result.fail(new MerchantNotFound({ merchantId }));
              }

              const other = await summaryByName(transaction, wanted, found.id);

              if (other !== undefined) {
                return Result.fail(new MerchantNameTaken({ name: other.name }));
              }

              await transaction
                .update(merchant)
                .set({ name: wanted })
                .where(eq(merchant.id, found.id));

              return Result.succeed({ ...found, name: wanted });
            },
          );

          return yield* Effect.fromResult(renamed);
        }),

      moveAlias: (owner, merchantId, alias, to) =>
        Effect.gen(function* () {
          const wanted = yield* Effect.fromResult(nameOf(to));
          const cleaned = asAlias(alias);

          const moved = yield* inTransaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<AliasMoved, MerchantNotFound | MerchantAliasNotFound>> => {
              // Its entries follow the defaults as they are: a default set meanwhile waits.
              await takeCategoryTurn(transaction, owner);

              const from = await summaryById(transaction, merchantId);

              if (from === undefined) {
                return Result.fail(new MerchantNotFound({ merchantId }));
              }

              const [row] = await transaction
                .select({ id: merchantAlias.id })
                .from(merchantAlias)
                .where(and(eq(merchantAlias.alias, cleaned), eq(merchantAlias.merchantId, from.id)))
                .for("update");

              if (row === undefined) {
                return Result.fail(new MerchantAliasNotFound({ alias: cleaned }));
              }

              const existing = await summaryByName(transaction, wanted);

              const target =
                existing ??
                (
                  await transaction
                    .insert(merchant)
                    .values({ userId: owner, name: wanted })
                    .returning({
                      id: merchant.id,
                      name: merchant.name,
                      intermediary: merchant.isIntermediary,
                    })
                ).map((made) => ({ ...made, aliases: 0 }))[0];

              if (target === undefined || target.id === from.id) {
                return Result.succeed({ alias: cleaned, from, to: from, created: false });
              }

              await transaction
                .update(merchantAlias)
                .set({ merchantId: target.id })
                .where(eq(merchantAlias.id, row.id));

              // Its lines' entries follow their new merchant's default category.
              await classifyByMerchants(transaction, { every: true });

              return Result.succeed({
                alias: cleaned,
                from: { ...from, aliases: from.aliases - 1 },
                to: { ...target, aliases: target.aliases + 1 },
                created: existing === undefined,
              });
            },
          );

          return yield* Effect.fromResult(moved);
        }),

      merge: (owner, merchantId, intoId) =>
        Effect.gen(function* () {
          const merged = yield* inTransaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<Merged, MerchantNotFound | MerchantMergeRefused>> => {
              // The defaults it reads and moves stay as they are until it commits.
              await takeCategoryTurn(transaction, owner);

              const from = await summaryById(transaction, merchantId);
              const into = await summaryById(transaction, intoId);

              if (from === undefined) {
                return Result.fail(new MerchantNotFound({ merchantId }));
              }

              if (into === undefined) {
                return Result.fail(new MerchantNotFound({ merchantId: intoId }));
              }

              if (from.id === into.id) {
                return Result.fail(new MerchantMergeRefused({ merchantId }));
              }

              const moved = await transaction
                .update(merchantAlias)
                .set({ merchantId: into.id })
                .where(eq(merchantAlias.merchantId, from.id))
                .returning({ id: merchantAlias.id });

              // The merchant kept keeps its default category, and takes the merged one's when it
              // has none; it is an intermediary when either was (#30).
              await transaction
                .update(merchant)
                .set({
                  defaultCategoryId: sql`coalesce(${merchant.defaultCategoryId}, (select m.default_category_id from ${merchant} m where m.id = ${from.id}))`,
                  isIntermediary: from.intermediary || into.intermediary,
                })
                .where(eq(merchant.id, into.id));

              // The rules that set the merged one, and the entries they gave it, go to the one kept
              // (#25): its deletion would clear them.
              await transaction
                .update(rule)
                .set({ setMerchantId: into.id })
                .where(eq(rule.setMerchantId, from.id));

              await transaction
                .update(entry)
                .set({ merchantId: into.id })
                .where(eq(entry.merchantId, from.id));

              await transaction.delete(merchant).where(eq(merchant.id, from.id));

              // The merged one's entries follow the kept one's default category.
              await classifyByMerchants(transaction, { every: true });

              return Result.succeed({
                into: {
                  ...into,
                  aliases: into.aliases + moved.length,
                  intermediary: from.intermediary || into.intermediary,
                },
                merged: from.name,
                aliasesMoved: moved.length,
              });
            },
          );

          return yield* Effect.fromResult(merged);
        }),

      recognise: (owner) => inTransaction(owner, (transaction) => recogniseIn(transaction, owner)),

      markIntermediary: (owner, merchantId, intermediary) =>
        inTransaction(owner, async (transaction) => {
          const found = await summaryById(transaction, merchantId);

          if (found === undefined) {
            return undefined;
          }

          await transaction
            .update(merchant)
            .set({ isIntermediary: intermediary })
            .where(eq(merchant.id, found.id));

          return { ...found, intermediary };
        }).pipe(
          Effect.flatMap((marked) =>
            marked === undefined
              ? Effect.fail(new MerchantNotFound({ merchantId }))
              : Effect.succeed(marked),
          ),
        ),

      markSubscription: (owner, merchantId, dismissed) =>
        inTransaction(owner, async (transaction) => {
          const found = await summaryById(transaction, merchantId);

          if (found === undefined) {
            return undefined;
          }

          await transaction
            .update(merchant)
            .set({ subscriptionDismissed: dismissed })
            .where(eq(merchant.id, found.id));

          return found;
        }).pipe(
          Effect.flatMap((marked) =>
            marked === undefined
              ? Effect.fail(new MerchantNotFound({ merchantId }))
              : Effect.succeed(marked),
          ),
        ),

      ofLine: (owner, lineId) =>
        inTransaction(owner, (transaction) => lineMerchantIn(transaction, lineId)).pipe(
          Effect.flatMap((found) =>
            found === undefined ? Effect.fail(new LineNotFound({ lineId })) : Effect.succeed(found),
          ),
        ),

      assignLine: (owner, lineId, name) =>
        Effect.gen(function* () {
          const wanted = yield* Effect.fromResult(nameOf(name));

          const assigned = yield* inTransaction(owner, (transaction) =>
            assignLineMerchantIn(transaction, owner, lineId, wanted),
          );

          return yield* Effect.fromResult(assigned);
        }),
    };
  }),
);

/**
 * Recognises, for `owner`, the merchant of every line whose cleaned label names none yet: what each
 * import does at its end, and what the app does once at boot for every user, so that the lines kept
 * before merchants existed (v0.2) get theirs without waiting for an import.
 */
export const recogniseMerchants = (owner: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, (transaction) => recogniseIn(transaction, owner));
  });

/** A blank text searches nothing; a limit outside 1 to 500 is brought within. */
function queryOf(search: MerchantSearch) {
  const text = search.text?.trim() ?? "";
  const after = search.after ?? "";
  const limit = search.limit;

  return {
    text: text === "" ? null : text,
    after: after === "" ? null : after,
    limit:
      limit === undefined || !Number.isFinite(limit)
        ? DEFAULT_MERCHANTS_LISTED
        : Math.min(Math.max(Math.trunc(limit), 1), MAX_MERCHANTS_LISTED),
  };
}

/** The user's merchants by name, a page at a time, those matching `search.text` when given. */
export const listMerchants = (owner: string, search: MerchantSearch = {}) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.list(owner, queryOf(search));
  });

/** Marks one of the user's merchants a payment intermediary, or not (#30). */
export const markIntermediary = (owner: string, merchantId: string, intermediary: boolean) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.markIntermediary(owner, merchantId, intermediary);
  });

/**
 * Says the payments of one of the user's merchants are no subscription (`dismissed` true), so that
 * none is proposed again, or takes it back (#34). A merge keeps the kept merchant's own answer.
 */
export const markSubscription = (owner: string, merchantId: string, dismissed: boolean) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.markSubscription(owner, merchantId, dismissed);
  });

/**
 * Who a line of the user's paid (its entry's merchant, else its label's), the intermediary its label
 * names, and whether who was paid is asked of the user (#30).
 */
export const lineMerchant = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.ofLine(owner, lineId);
  });

/**
 * Sets who was paid on an intermediary's line of the user's: the merchant named `name` (any case,
 * trimmed), made when none has it (#30). The entry is then the user's choice, and goes in the
 * merchant's default category when it was not classified yet.
 */
export const assignLineMerchant = (owner: string, lineId: string, name: string) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.assignLine(owner, lineId, name);
  });

/** One merchant of the user's, its cleaned labels and its latest lines up to today. */
export const showMerchant = (owner: string, merchantId: string) =>
  Effect.gen(function* () {
    const merchants = yield* Merchants;
    const day = yield* today;

    return yield* merchants.show(owner, merchantId, day);
  });
