import {
  account,
  category,
  entry,
  entryPart,
  merchant,
  rule,
  statementLine,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, count, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Layer, Result } from "effect";

import { CategoryStore } from "./category-store";
import type {
  Benchmark,
  CategoryChange,
  CategoryPatch,
  CategoryRecord,
  CategoryStep,
  LineCategory,
  LineEntries,
} from "./category-store";
import { takeCategoryTurn } from "./category-turn";
import { CategoryNotFound, LineNotFound } from "./errors";
import { classifyByMerchants } from "./merchants/default-classification";
import { MerchantNotFound } from "./merchants/errors";

// The categories, through `UserData` only (docs/data-model.md, "Ownership and isolation"). Every
// value goes in as a parameter, never into the SQL's text.

/** A uuid, as the database writes them: anything else names no row, and would fail the query. */
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

type CategoryRow = typeof category.$inferSelect;

function benchmarkOf(row: CategoryRow): Benchmark {
  switch (row.benchmarkMode) {
    case "fixed": {
      return row.benchmarkMinor === null
        ? { mode: "automatic" }
        : { mode: "fixed", minor: row.benchmarkMinor };
    }

    case "automatic":
    case "none": {
      return { mode: row.benchmarkMode };
    }
  }
}

function record(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    icon: row.icon,
    position: row.position,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    benchmark: benchmarkOf(row),
    fallback: row.isFallback,
  };
}

/** A benchmark as its two columns. */
const benchmarkColumns = (benchmark: Benchmark) => ({
  benchmarkMode: benchmark.mode,
  benchmarkMinor: benchmark.mode === "fixed" ? benchmark.minor : null,
});

/** A patch as the columns it sets. */
function columnsOf(patch: CategoryPatch): Partial<typeof category.$inferInsert> {
  const { benchmark, archivedAt, ...rest } = patch;
  const columns: Partial<typeof category.$inferInsert> = { ...rest };

  if (benchmark !== undefined) {
    Object.assign(columns, benchmarkColumns(benchmark));
  }

  if (archivedAt !== undefined) {
    columns.archivedAt = archivedAt === null ? null : new Date(archivedAt);
  }

  return columns;
}

async function readAll(transaction: UserTransaction): Promise<ReadonlyArray<CategoryRecord>> {
  const rows = await transaction.select().from(category);

  return rows.map(record);
}

async function apply(
  transaction: UserTransaction,
  owner: string,
  steps: ReadonlyArray<CategoryStep>,
): Promise<ReadonlyArray<string>> {
  const inserted: Array<string> = [];

  for (const step of steps) {
    switch (step.step) {
      case "insert": {
        const { benchmark, fallback, ...rest } = step.category;

        const [made] = await transaction
          .insert(category)
          .values({ userId: owner, ...rest, ...benchmarkColumns(benchmark), isFallback: fallback })
          .returning({ id: category.id });

        if (made === undefined) {
          throw new Error("The insert returned no row.");
        }

        inserted.push(made.id);
        break;
      }

      case "update": {
        await transaction
          .update(category)
          .set(columnsOf(step.patch))
          .where(eq(category.id, step.id));
        break;
      }

      case "move_entries": {
        await transaction
          .update(entry)
          .set({ categoryId: step.into })
          .where(eq(entry.categoryId, step.from));
        break;
      }

      case "move_defaults": {
        await transaction
          .update(merchant)
          .set({ defaultCategoryId: step.into })
          .where(eq(merchant.defaultCategoryId, step.from));

        // The rules that set it go with the merchants' defaults (#25): its deletion would clear them.
        await transaction
          .update(rule)
          .set({ setCategoryId: step.into })
          .where(eq(rule.setCategoryId, step.from));

        // An account kept by its balance sends its movement to the target too (#31).
        await transaction
          .update(account)
          .set({ balanceCategoryId: step.into })
          .where(eq(account.balanceCategoryId, step.from));
        break;
      }

      case "delete": {
        // A category still in use, or with children, is refused by its kept references at commit;
        // a merchant's default on it, and an account's category, are cleared by their keys.
        await transaction.delete(category).where(eq(category.id, step.id));
        break;
      }
    }
  }

  return inserted;
}

const parent = alias(category, "parent");

/** A category with its parent's name, as a line's or a merchant's default shows it. */
async function shownCategory(
  transaction: UserTransaction,
  categoryId: string,
): Promise<LineCategory | undefined> {
  const [shown] = await transaction
    .select({
      id: category.id,
      name: category.name,
      parentName: parent.name,
      kind: category.kind,
    })
    .from(category)
    .leftJoin(parent, eq(parent.id, category.parentId))
    .where(eq(category.id, categoryId));

  return shown;
}

/** `CategoryStore` on the user's tables, through `UserData`. */
export const DatabaseCategoryStore = Layer.effect(
  CategoryStore,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      list: (owner) => userData.transaction(owner, readAll),

      use: (owner, range) =>
        userData.transaction(owner, async (transaction) => {
          const counts = await transaction
            .select({ categoryId: entry.categoryId, entries: count() })
            .from(entry)
            .groupBy(entry.categoryId);

          const nets = await transaction
            .select({
              categoryId: entry.categoryId,
              currency: account.currency,
              minor:
                sql<number>`sum(case when ${entryPart.role} = 'payment' then ${entryPart.amountMinor} else -${entryPart.amountMinor} end)::bigint`.mapWith(
                  Number,
                ),
            })
            .from(entry)
            .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
            .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
            .innerJoin(account, eq(account.id, statementLine.accountId))
            .where(and(gte(entry.happenedOn, range.from), lte(entry.happenedOn, range.to)))
            .groupBy(entry.categoryId, account.currency)
            .orderBy(account.currency);

          return counts.map((each) => ({
            categoryId: each.categoryId,
            entries: each.entries,
            net: nets.flatMap((net) =>
              net.categoryId === each.categoryId
                ? [{ currency: net.currency, minor: net.minor }]
                : [],
            ),
          }));
        }),

      change: <E>(
        owner: string,
        decide: (
          categories: ReadonlyArray<CategoryRecord>,
        ) => Result.Result<ReadonlyArray<CategoryStep>, E>,
      ) =>
        userData
          .transaction(owner, async (transaction): Promise<Result.Result<CategoryChange, E>> => {
            // A user's changes of the categories take turns until the transaction ends, so that
            // each decides on what the other left (a name taken, the cap, a parent archived): a
            // lock on the existing rows would let two inserts through at once.
            await takeCategoryTurn(transaction, owner);

            const rows = await transaction.select().from(category).for("update");
            const decided = decide(rows.map(record));

            if (Result.isFailure(decided)) {
              return Result.fail(decided.failure);
            }

            const inserted = await apply(transaction, owner, decided.success);

            return Result.succeed({ categories: await readAll(transaction), inserted });
          })
          .pipe(Effect.flatMap(Effect.fromResult)),

      classifyLine: <E>(
        owner: string,
        lineId: string,
        decide: (
          facts: LineEntries,
        ) => Result.Result<{ readonly entryId: string; readonly categoryId: string }, E>,
      ) =>
        userData
          .transaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<LineCategory, E | LineNotFound | CategoryNotFound>> => {
              if (!UUID.test(lineId)) {
                return Result.fail(new LineNotFound({ lineId }));
              }

              // Row-level security keeps another user's line out: as good as unknown. The line is
              // locked, so that a concurrent change of it waits.
              const [line] = await transaction
                .select({ id: statementLine.id, amountMinor: statementLine.amountMinor })
                .from(statementLine)
                .where(eq(statementLine.id, lineId))
                .for("update");

              if (line === undefined) {
                return Result.fail(new LineNotFound({ lineId }));
              }

              const entries = await transaction
                .selectDistinct({ id: entry.id, kind: entry.kind })
                .from(entry)
                .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
                .where(eq(entryPart.lineId, lineId))
                .orderBy(entry.id);

              const sides = await transaction
                .select({ id: transfer.id })
                .from(transfer)
                .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

              const decided = decide({
                lineId,
                amountMinor: line.amountMinor,
                entries,
                paired: sides.length > 0,
                categories: await readAll(transaction),
              });

              if (Result.isFailure(decided)) {
                return Result.fail(decided.failure);
              }

              const { entryId, categoryId } = decided.success;

              await transaction
                .update(entry)
                .set({ categoryId, classifiedBy: "user" })
                .where(eq(entry.id, entryId));

              const chosen = await shownCategory(transaction, categoryId);

              return chosen === undefined
                ? Result.fail(new CategoryNotFound({ categoryId }))
                : Result.succeed(chosen);
            },
          )
          .pipe(Effect.flatMap(Effect.fromResult)),

      setMerchantDefault: <E>(
        owner: string,
        merchantId: string,
        decide: (categories: ReadonlyArray<CategoryRecord>) => Result.Result<string | null, E>,
      ) =>
        userData
          .transaction(
            owner,
            async (
              transaction,
            ): Promise<Result.Result<LineCategory | null, E | MerchantNotFound>> => {
              if (!UUID.test(merchantId)) {
                return Result.fail(new MerchantNotFound({ merchantId }));
              }

              // Its turn among the changes of the categories: the category chosen is not archived
              // nor merged away before it commits, and no recognition, merge or move of merchants
              // classifies entries by the default it replaces meanwhile (`./category-turn`).
              await takeCategoryTurn(transaction, owner);

              const [found] = await transaction
                .select({ id: merchant.id })
                .from(merchant)
                .where(eq(merchant.id, merchantId))
                .for("update");

              if (found === undefined) {
                return Result.fail(new MerchantNotFound({ merchantId }));
              }

              const decided = decide(await readAll(transaction));

              if (Result.isFailure(decided)) {
                return Result.fail(decided.failure);
              }

              const categoryId = decided.success;

              await transaction
                .update(merchant)
                .set({ defaultCategoryId: categoryId })
                .where(eq(merchant.id, found.id));

              // Its entries still classified by default follow: to the new category, or back to
              // their kind's fallback.
              await classifyByMerchants(transaction, { merchantId: found.id });

              return Result.succeed(
                categoryId === null
                  ? null
                  : ((await shownCategory(transaction, categoryId)) ?? null),
              );
            },
          )
          .pipe(Effect.flatMap(Effect.fromResult)),
    };
  }),
);

/**
 * The category of each line among `lineIds` that has exactly one entry; a line with none, or split
 * across several, is left out. For the lines' search and detail (`./line-store-database`).
 */
export async function categoriesOfLines(
  transaction: UserTransaction,
  lineIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, LineCategory>> {
  if (lineIds.length === 0) {
    return new Map();
  }

  const rows = await transaction
    .selectDistinct({
      lineId: entryPart.lineId,
      entryId: entry.id,
      id: category.id,
      name: category.name,
      parentName: parent.name,
      kind: category.kind,
    })
    .from(entryPart)
    .innerJoin(entry, eq(entry.id, entryPart.entryId))
    .innerJoin(category, eq(category.id, entry.categoryId))
    .leftJoin(parent, eq(parent.id, category.parentId))
    .where(inArray(entryPart.lineId, [...lineIds]));

  const byLine = new Map<string, Array<(typeof rows)[number]>>();

  for (const row of rows) {
    const known = byLine.get(row.lineId);

    if (known === undefined) {
      byLine.set(row.lineId, [row]);
    } else {
      known.push(row);
    }
  }

  const categories = new Map<string, LineCategory>();

  for (const [lineId, each] of byLine) {
    const [only, ...others] = each;

    if (only !== undefined && others.length === 0) {
      categories.set(lineId, {
        id: only.id,
        name: only.name,
        parentName: only.parentName,
        kind: only.kind,
      });
    }
  }

  return categories;
}
