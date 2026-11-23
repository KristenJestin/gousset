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

/** One user's rows. */
export type MemoryCategoryRows = {
  categories: Array<CategoryRecord>;
  entries: Array<MemoryEntry>;
  /** The lines that exist, by id, with their amount, and whether each is a side of a transfer. */
  lines: Array<{ readonly id: string; readonly amountMinor: number; readonly paired?: boolean }>;
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

      case "delete": {
        categories = categories.filter((each) => each.id !== step.id);
        break;
      }
    }
  }

  // The kept references, checked at commit.
  const ids = new Set(categories.map((each) => each.id));

  const dangling =
    entries.some((each) => !ids.has(each.categoryId)) ||
    categories.some((each) => each.parentId !== null && !ids.has(each.parentId));

  return dangling ? undefined : { rows: { ...rows, categories, entries }, inserted };
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
  }));
}
