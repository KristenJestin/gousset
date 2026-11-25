import { Effect, Layer } from "effect";

import { memoryId } from "./account-store-memory";
import { CategoryStore } from "./category-store";
import type {
  CategoryRecord,
  CategoryStep,
  CategoryUse,
  EntryKind,
  LineCategory,
} from "./category-store";
import { CategoryNotFound, LineNotFound } from "./errors";
import { defaultCategoryMoves } from "./merchants/default-classification";
import type { DefaultEntry, MerchantDefault } from "./merchants/default-classification";
import { MerchantNotFound } from "./merchants/errors";

// An in-memory `CategoryStore`, for tests: each user's categories, entries with their parts, and
// lines, changed in place. A change that fails, or would leave an entry or a child pointing to a
// deleted category, changes nothing, as the database's transaction would roll back.

/** A part of a line an entry is made of, with its account's currency. */
export type MemoryPart = {
  readonly lineId: string;
  readonly role: "payment" | "refund";
  readonly amountMinor: number;
  readonly currency: string;
};

export type MemoryEntry = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly happenedOn: string;
  readonly categoryId: string;
  readonly classifiedBy: "default" | "rule" | "user";
  readonly parts: ReadonlyArray<MemoryPart>;
};

/** A merchant, with the category its entries go in by default, and the lines its labels name. */
export type MemoryMerchant = {
  readonly id: string;
  readonly defaultCategoryId: string | null;
  readonly lineIds?: ReadonlyArray<string>;
};

/**
 * The entries of `merchant`'s lines moved as its default category says, as the database does
 * (`./merchants/default-classification`): an entry is the merchant's when every line paying it is.
 */
function classifiedBy(
  rows: MemoryCategoryRows,
  merchant: MemoryMerchant,
): ReadonlyArray<MemoryEntry> {
  const lines = new Set(merchant.lineIds ?? []);
  const chosen = rows.categories.find((each) => each.id === merchant.defaultCategoryId);

  const defaults = new Map<string, MerchantDefault>(
    chosen === undefined
      ? []
      : [
          [
            merchant.id,
            { categoryId: chosen.id, kind: chosen.kind, archived: chosen.archivedAt !== null },
          ],
        ],
  );

  const fallbacks = new Map(
    rows.categories.flatMap((each) => (each.fallback ? [[each.kind, each.id] as const] : [])),
  );

  const entries = rows.entries.map((each): DefaultEntry => {
    const payments = each.parts.filter((part) => part.role === "payment");

    const own =
      payments.length > 0 && payments.every((part) => lines.has(part.lineId)) ? merchant.id : null;

    // One merchant's default is weighed here: no line of an operation's category (#194).
    return { ...each, merchantId: own, operation: null };
  });

  const moves = new Map(
    defaultCategoryMoves(entries, defaults, fallbacks).map((move) => [
      move.entryId,
      move.categoryId,
    ]),
  );

  return rows.entries.map((each) => {
    const target = moves.get(each.id);

    return target === undefined ? each : { ...each, categoryId: target };
  });
}

/** One user's rows. */
export type MemoryCategoryRows = {
  categories: Array<CategoryRecord>;
  entries: Array<MemoryEntry>;
  /** The lines that exist, by id, with their amount, and whether each is a side of a transfer. */
  lines: Array<{ readonly id: string; readonly amountMinor: number; readonly paired?: boolean }>;
  /** The merchants; none when left out. */
  merchants?: Array<MemoryMerchant>;
};

/** A category of the memory store: top-level, in use, automatic, unless said otherwise. */
export function memoryCategory(
  kind: EntryKind,
  name: string,
  change: Partial<CategoryRecord> = {},
): CategoryRecord {
  return {
    id: memoryId(),
    parentId: null,
    kind,
    name,
    icon: null,
    position: 0,
    archivedAt: null,
    benchmark: { mode: "automatic" },
    fallback: false,
    ...change,
  };
}

function applied(
  rows: MemoryCategoryRows,
  steps: ReadonlyArray<CategoryStep>,
): { readonly rows: MemoryCategoryRows; readonly inserted: ReadonlyArray<string> } | undefined {
  let categories = [...rows.categories];
  let entries = [...rows.entries];
  let merchants = [...(rows.merchants ?? [])];
  const inserted: Array<string> = [];

  for (const step of steps) {
    switch (step.step) {
      case "insert": {
        const id = memoryId();

        categories.push({ ...step.category, id, archivedAt: null });
        inserted.push(id);
        break;
      }

      case "update": {
        categories = categories.map((each) =>
          each.id === step.id ? { ...each, ...step.patch } : each,
        );
        break;
      }

      case "move_entries": {
        entries = entries.map((each) =>
          each.categoryId === step.from ? { ...each, categoryId: step.into } : each,
        );
        break;
      }

      case "move_defaults": {
        merchants = merchants.map((each) =>
          each.defaultCategoryId === step.from ? { ...each, defaultCategoryId: step.into } : each,
        );
        break;
      }

      case "delete": {
        categories = categories.filter((each) => each.id !== step.id);
        // As the key's `on delete set null (default_category_id)`.
        merchants = merchants.map((each) =>
          each.defaultCategoryId === step.id ? { ...each, defaultCategoryId: null } : each,
        );
        break;
      }
    }
  }

  // The kept references, checked at commit.
  const ids = new Set(categories.map((each) => each.id));

  const dangling =
    entries.some((each) => !ids.has(each.categoryId)) ||
    categories.some((each) => each.parentId !== null && !ids.has(each.parentId));

  return dangling ? undefined : { rows: { ...rows, categories, entries, merchants }, inserted };
}

/** A `CategoryStore` holding each user's rows in memory, `rows` by owner, changed in place. */
export function memoryCategoryStore(rows: Map<string, MemoryCategoryRows> = new Map()) {
  const of = (owner: string): MemoryCategoryRows =>
    rows.get(owner) ?? { categories: [], entries: [], lines: [] };

  return Layer.sync(CategoryStore, () => ({
    list: (owner) => Effect.sync(() => of(owner).categories),

    use: (owner, range) =>
      Effect.sync(() =>
        of(owner).categories.flatMap((category): ReadonlyArray<CategoryUse> => {
          const own = of(owner).entries.filter((each) => each.categoryId === category.id);
          const net = new Map<string, number>();

          for (const each of own) {
            if (each.happenedOn < range.from || each.happenedOn > range.to) {
              continue;
            }

            for (const part of each.parts) {
              const signed = part.role === "payment" ? part.amountMinor : -part.amountMinor;

              net.set(part.currency, (net.get(part.currency) ?? 0) + signed);
            }
          }

          return own.length === 0
            ? []
            : [
                {
                  categoryId: category.id,
                  entries: own.length,
                  net: [...net].map(([currency, minor]) => ({ currency, minor })),
                },
              ];
        }),
      ),

    change: (owner, decide) =>
      Effect.gen(function* () {
        const own = of(owner);
        const steps = yield* Effect.fromResult(decide(own.categories));
        const result = applied(own, steps);

        if (result === undefined) {
          // As the database refuses it at commit: a category deleted while still in use.
          return yield* Effect.die(new Error("A kept reference points to a deleted category."));
        }

        rows.set(owner, result.rows);

        return { categories: result.rows.categories, inserted: result.inserted };
      }),

    classifyLine: (owner, lineId, decide) =>
      Effect.gen(function* () {
        const own = of(owner);
        const line = own.lines.find((each) => each.id === lineId);

        if (line === undefined) {
          return yield* new LineNotFound({ lineId });
        }

        const entries = own.entries
          .filter((each) => each.parts.some((part) => part.lineId === lineId))
          .map((each) => ({ id: each.id, kind: each.kind }));

        const chosen = yield* Effect.fromResult(
          decide({
            lineId,
            amountMinor: line.amountMinor,
            entries,
            paired: line.paired === true,
            categories: own.categories,
          }),
        );

        const category = own.categories.find((each) => each.id === chosen.categoryId);

        if (category === undefined) {
          return yield* new CategoryNotFound({ categoryId: chosen.categoryId });
        }

        rows.set(owner, {
          ...own,
          entries: own.entries.map((each) =>
            each.id === chosen.entryId
              ? { ...each, categoryId: category.id, classifiedBy: "user" as const }
              : each,
          ),
        });

        const parent = own.categories.find((each) => each.id === category.parentId);

        const shown: LineCategory = {
          id: category.id,
          name: category.name,
          parentName: parent?.name ?? null,
          kind: category.kind,
        };

        return shown;
      }),

    setMerchantDefault: (owner, merchantId, decide) =>
      Effect.gen(function* () {
        const own = of(owner);
        const merchants = own.merchants ?? [];

        if (!merchants.some((each) => each.id === merchantId)) {
          return yield* new MerchantNotFound({ merchantId });
        }

        const categoryId = yield* Effect.fromResult(decide(own.categories));
        const category = own.categories.find((each) => each.id === categoryId);

        const updated = merchants.map((each) =>
          each.id === merchantId ? { ...each, defaultCategoryId: category?.id ?? null } : each,
        );

        const changed = updated.find((each) => each.id === merchantId);
        const withDefault = { ...own, merchants: updated };

        rows.set(owner, {
          ...withDefault,
          entries: changed === undefined ? own.entries : [...classifiedBy(withDefault, changed)],
        });

        if (category === undefined) {
          return null;
        }

        const parent = own.categories.find((each) => each.id === category.parentId);

        const shown: LineCategory = {
          id: category.id,
          name: category.name,
          parentName: parent?.name ?? null,
          kind: category.kind,
        };

        return shown;
      }),
  }));
}
