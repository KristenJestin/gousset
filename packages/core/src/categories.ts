import type { QueryFailed } from "@gousset/db/user-data";
import { Clock, Effect, Result } from "effect";

import { monthsCounted } from "./benchmarks";
import { CategoryStore } from "./category-store";
import type {
  Benchmark,
  CategoryPatch,
  CategoryRecord,
  CategoryStep,
  EntryKind,
  LineCategory,
} from "./category-store";
import {
  CategoryKindMismatch,
  CategoryNameAmbiguous,
  CategoryNameTaken,
  CategoryNameUnknown,
  CategoryNotFound,
  CategoryRefused,
  LineNotClassifiable,
} from "./errors";
import type { Money } from "./month";
import { today } from "./today";
import { addMonths } from "./values";

// The categories (#23; docs/data-model.md, v0.3), for the web app's server functions and the MCP
// door alike: two levels of expense and income categories, each kind with its fallback, "Other".
// Every rule is decided here, inside the store's transaction, on what that transaction read.

/** A name, once trimmed, has 1 to 100 characters. */
export const MAX_CATEGORY_NAME = 100;

/** How many categories a user may have, archived ones included. */
export const MAX_CATEGORIES = 300;

/** The months an automatic benchmark averages: the full months before the current one. */
export const AVERAGE_MONTHS = 6;

const MAX_POSITION = 1_000_000;

/** A key of the icons shipped with packages/ui. */
const ICON = /^[a-z\d-]{1,64}$/;

/** "Parent > Child": how a child is named where a name alone is not enough. */
const PATH_SEPARATOR = ">";

/** A category as the categories page and the MCP door list it. */
export type CategoryNode = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly name: string;
  readonly icon: string | null;
  readonly position: number;
  /** Null for a top-level category. */
  readonly parentId: string | null;
  /** When it was archived, ISO 8601; null while in use. */
  readonly archivedAt: string | null;
  /** Its kind's fallback, "Other": never archived nor merged away. */
  readonly fallback: boolean;
  readonly benchmark: Benchmark;
  /** Its own entries, whenever they happened. */
  readonly entries: number;
  /**
   * The monthly average of its own entries' net amount over the six full months before the
   * current one (`averageFrom` to `averageTo`), by the day each happened: one per currency, never
   * converted, positive the kind's way (spent for an expense, received for an income).
   */
  readonly average: ReadonlyArray<Money>;
  /** A top-level category's average with its children's, per currency; its own for a child. */
  readonly averageWithChildren: ReadonlyArray<Money>;
  /** Its children in order (position, then id); empty for a child. */
  readonly children: ReadonlyArray<CategoryNode>;
};

/** Every category of the user's, as a tree per kind, siblings in order. */
export type CategoryTree = {
  readonly expense: ReadonlyArray<CategoryNode>;
  readonly income: ReadonlyArray<CategoryNode>;
  /** The first day the averages read. */
  readonly averageFrom: string;
  /** The last day the averages read: the end of the month before the current one. */
  readonly averageTo: string;
};

/** What listing the categories reads beyond the user's own. */
export type CategoryListing = {
  /** Archived categories too (an archived parent's children with it); left out by default. */
  readonly archived?: boolean;
};

/** A new category. */
export type CategoryInput = {
  readonly kind: EntryKind;
  readonly name: string;
  /** A top-level category of the same kind to go under; none for a top-level one. */
  readonly parentId?: string | null;
  readonly icon?: string | null;
  /** Automatic by default. */
  readonly benchmark?: Benchmark;
  /** Last among its siblings by default. */
  readonly position?: number;
};

/** What an edit changes; what is left out stays. */
export type CategoryEdit = {
  readonly name?: string;
  /** A top-level category of the same kind to go under, or null for the top. */
  readonly parentId?: string | null;
  readonly icon?: string | null;
  readonly benchmark?: Benchmark;
  /** Among its siblings, ordered by (position, id); last among new siblings on a move. */
  readonly position?: number;
};

/** What a merge did. */
export type CategoryMerge = {
  readonly into: CategoryRecord;
  /** The merged category's children that went under the target as they were. */
  readonly childrenMoved: number;
  /** Its children merged into the target's child of the same name. */
  readonly childrenMerged: number;
};

const refused = (reason: CategoryRefused["reason"]) => Result.fail(new CategoryRefused({ reason }));

/** Postgres's code for a row its unique key refuses. */
const UNIQUE_VIOLATION = "23505";

/**
 * A name the database's unique key refuses at commit, taken by a change of another session: the
 * name taken it is, as the rules would have said.
 */
const takenAtCommit = (failed: QueryFailed, name: string) =>
  Effect.fail(failed.code === UNIQUE_VIOLATION ? new CategoryNameTaken({ name }) : failed);

/** A change that would archive or delete a fallback, which names it. */
const fallbackRefused = (fallback: CategoryRecord) =>
  Result.fail(new CategoryRefused({ reason: "fallback", fallback: fallback.name }));

const sameText = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;

/** Siblings in order: position, then id. */
const inOrder = (a: CategoryRecord, b: CategoryRecord) =>
  a.position - b.position || a.id.localeCompare(b.id);

const childrenOf = (categories: ReadonlyArray<CategoryRecord>, parentId: string) =>
  categories.filter((each) => each.parentId === parentId);

/** "Parent > Child" for a child, its name for a top-level category. */
function pathOf(categories: ReadonlyArray<CategoryRecord>, category: CategoryRecord): string {
  const parent = categories.find((each) => each.id === category.parentId);

  return parent === undefined ? category.name : `${parent.name} ${PATH_SEPARATOR} ${category.name}`;
}

function nameOf(raw: string): Result.Result<string, CategoryRefused> {
  const name = raw.trim();

  return name.length === 0 || name.length > MAX_CATEGORY_NAME || name.includes(PATH_SEPARATOR)
    ? refused("name")
    : Result.succeed(name);
}

function benchmarkOf(benchmark: Benchmark): Result.Result<Benchmark, CategoryRefused> {
  if (benchmark.mode !== "fixed") {
    return Result.succeed(benchmark);
  }

  return Number.isSafeInteger(benchmark.minor) && benchmark.minor >= 0
    ? Result.succeed(benchmark)
    : refused("benchmark");
}

function iconOf(icon: string | null): Result.Result<string | null, CategoryRefused> {
  return icon === null || ICON.test(icon) ? Result.succeed(icon) : refused("icon");
}

function positionOf(position: number): Result.Result<number, CategoryRefused> {
  return Number.isInteger(position) && position >= 0 && position <= MAX_POSITION
    ? Result.succeed(position)
    : refused("position");
}

/** The position after every sibling's. */
function lastPosition(siblings: ReadonlyArray<CategoryRecord>): number {
  return Math.min(
    siblings.reduce((highest, each) => Math.max(highest, each.position + 1), 0),
    MAX_POSITION,
  );
}

/** Whether a sibling of the same kind and parent, but `self`, already has `name`. */
function nameTaken(
  categories: ReadonlyArray<CategoryRecord>,
  kind: EntryKind,
  parentId: string | null,
  name: string,
  self: string | undefined,
): boolean {
  return categories.some(
    (each) =>
      each.id !== self &&
      each.kind === kind &&
      each.parentId === parentId &&
      sameText(each.name, name),
  );
}

/**
 * The parent a category of `kind` may go under: a top-level category of that kind, in use, not
 * itself. A category with children stays at the top: a third level is refused.
 */
function parentFor(
  categories: ReadonlyArray<CategoryRecord>,
  parentId: string,
  kind: EntryKind,
  self: CategoryRecord | undefined,
): Result.Result<CategoryRecord, CategoryRefused | CategoryNotFound> {
  const parent = categories.find((each) => each.id === parentId);

  if (parent === undefined) {
    return Result.fail(new CategoryNotFound({ categoryId: parentId }));
  }

  if (self !== undefined && parent.id === self.id) {
    return refused("itself");
  }

  if (parent.kind !== kind) {
    return refused("parent_kind");
  }

  if (parent.parentId !== null) {
    return refused("third_level");
  }

  if (self !== undefined && childrenOf(categories, self.id).length > 0) {
    return refused("third_level");
  }

  if (parent.archivedAt !== null) {
    return refused("archived");
  }

  return Result.succeed(parent);
}

function found(
  categories: ReadonlyArray<CategoryRecord>,
  categoryId: string,
): Result.Result<CategoryRecord, CategoryNotFound> {
  const category = categories.find((each) => each.id === categoryId);

  return category === undefined
    ? Result.fail(new CategoryNotFound({ categoryId }))
    : Result.succeed(category);
}

/** The first day of the averages, and the last: the six full months before `day`'s. */
function averageRange(day: string) {
  const month = day.slice(0, 7);
  const from = `${addMonths(month, -AVERAGE_MONTHS)}-01`;
  const end = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86_400_000);

  return { from, to: end.toISOString().slice(0, 10), today: day };
}

/**
 * `net` summed per currency, then divided by the months counted (those from the user's first
 * entry on, `./benchmarks`), rounded to a whole minor unit.
 */
function averageOf(
  nets: ReadonlyArray<ReadonlyArray<{ readonly currency: string; readonly minor: number }>>,
  months: number,
): ReadonlyArray<Money> {
  const sums = new Map<string, number>();

  for (const net of nets) {
    for (const each of net) {
      sums.set(each.currency, (sums.get(each.currency) ?? 0) + each.minor);
    }
  }

  return [...sums]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => ({ currency, minor: Math.round(minor / Math.max(months, 1)) }));
}

/**
 * The user's categories as a tree per kind, siblings in order (position, then id), each with its
 * entries, its benchmark and its six-month average. Archived categories only when asked.
 */
export const listCategories = (owner: string, listing: CategoryListing = {}) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    const day = yield* today;
    const range = averageRange(day);
    const categories = yield* store.list(owner);
    const use = yield* store.use(owner, range);

    const months = monthsCounted(
      yield* store.firstEntry(owner),
      range.from.slice(0, 7),
      range.to.slice(0, 7),
    );

    const useOf = new Map(use.map((each) => [each.categoryId, each]));

    const shown = categories
      .filter((each) => listing.archived === true || each.archivedAt === null)
      .toSorted(inOrder);

    const nodeOf = (category: CategoryRecord, children: ReadonlyArray<CategoryNode>) => {
      const own = useOf.get(category.id);
      const netOf = (id: string) => useOf.get(id)?.net ?? [];

      const node: CategoryNode = {
        id: category.id,
        kind: category.kind,
        name: category.name,
        icon: category.icon,
        position: category.position,
        parentId: category.parentId,
        archivedAt: category.archivedAt,
        fallback: category.fallback,
        benchmark: category.benchmark,
        entries: own?.entries ?? 0,
        average: averageOf([own?.net ?? []], months),
        averageWithChildren: averageOf(
          [own?.net ?? [], ...childrenOf(categories, category.id).map((child) => netOf(child.id))],
          months,
        ),
        children,
      };

      return node;
    };

    const treeOf = (kind: EntryKind) =>
      shown
        .filter((each) => each.kind === kind && each.parentId === null)
        .map((top) =>
          nodeOf(
            top,
            childrenOf(shown, top.id).map((child) => nodeOf(child, [])),
          ),
        );

    const tree: CategoryTree = {
      expense: treeOf("expense"),
      income: treeOf("income"),
      averageFrom: range.from,
      averageTo: range.to,
    };

    return tree;
  });

/**
 * Creates a category, at the top or under a top-level category of its kind, last among its
 * siblings unless a position is given. Fails with `CategoryNotFound` (the parent),
 * `CategoryNameTaken` or `CategoryRefused` (`third_level`, `parent_kind`, `archived`, `name`,
 * `too_many`, `benchmark`, `icon`, `position`).
 */
export const createCategory = (owner: string, input: CategoryInput) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    let name = input.name.trim();

    const change = yield* store
      .change(
        owner,
        (
          categories,
        ): Result.Result<
          ReadonlyArray<CategoryStep>,
          CategoryRefused | CategoryNameTaken | CategoryNotFound
        > =>
          Result.gen(function* () {
            name = yield* nameOf(input.name);

            const benchmark = yield* benchmarkOf(input.benchmark ?? { mode: "automatic" });
            const icon = yield* iconOf(input.icon ?? null);
            const parentId = input.parentId ?? null;

            if (categories.length >= MAX_CATEGORIES) {
              return yield* refused("too_many");
            }

            if (parentId !== null) {
              yield* parentFor(categories, parentId, input.kind, undefined);
            }

            if (nameTaken(categories, input.kind, parentId, name, undefined)) {
              return yield* Result.fail(new CategoryNameTaken({ name }));
            }

            const siblings = categories.filter(
              (each) => each.kind === input.kind && each.parentId === parentId,
            );

            const position =
              input.position === undefined
                ? lastPosition(siblings)
                : yield* positionOf(input.position);

            const step: CategoryStep = {
              step: "insert",
              category: {
                parentId,
                kind: input.kind,
                name,
                icon,
                position,
                benchmark,
                fallback: false,
              },
            };

            return [step];
          }),
      )
      .pipe(Effect.catchTag("QueryFailed", (failed) => takenAtCommit(failed, name)));

    const [id] = change.inserted;

    return yield* Effect.fromResult(
      found(change.categories, id ?? "").pipe(
        Result.mapError(() => new CategoryNotFound({ categoryId: name })),
      ),
    );
  });

/**
 * Changes a category: its name, its place (at the top, or under a top-level category of its kind;
 * one with children stays at the top), its benchmark, its icon, its position among its siblings.
 * The fallback may be renamed and moved too. Fails with `CategoryNotFound`, `CategoryNameTaken` or
 * `CategoryRefused` (`third_level`, `parent_kind`, `itself`, `archived`, `name`, `benchmark`,
 * `icon`, `position`).
 */
export const editCategory = (owner: string, categoryId: string, edit: CategoryEdit) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    let taken = edit.name?.trim() ?? "";

    const change = yield* store
      .change(
        owner,
        (
          categories,
        ): Result.Result<
          ReadonlyArray<CategoryStep>,
          CategoryRefused | CategoryNameTaken | CategoryNotFound
        > =>
          Result.gen(function* () {
            const category = yield* found(categories, categoryId);
            const name = edit.name === undefined ? category.name : yield* nameOf(edit.name);

            taken = name;
            const parentId = edit.parentId === undefined ? category.parentId : edit.parentId;
            const moved = parentId !== category.parentId;

            if (moved && parentId !== null) {
              yield* parentFor(categories, parentId, category.kind, category);
            }

            if (nameTaken(categories, category.kind, parentId, name, category.id)) {
              return yield* Result.fail(new CategoryNameTaken({ name }));
            }

            const siblings = categories.filter(
              (each) =>
                each.kind === category.kind &&
                each.parentId === parentId &&
                each.id !== category.id,
            );

            const position =
              edit.position === undefined
                ? moved
                  ? lastPosition(siblings)
                  : category.position
                : yield* positionOf(edit.position);

            const patch: CategoryPatch = {
              name,
              parentId,
              position,
              icon: edit.icon === undefined ? category.icon : yield* iconOf(edit.icon),
              benchmark:
                edit.benchmark === undefined
                  ? category.benchmark
                  : yield* benchmarkOf(edit.benchmark),
            };

            const step: CategoryStep = { step: "update", id: category.id, patch };

            return [step];
          }),
      )
      .pipe(Effect.catchTag("QueryFailed", (failed) => takenAtCommit(failed, taken)));

    return yield* Effect.fromResult(found(change.categories, categoryId));
  });

/**
 * Merges a category into another of its kind, in one transaction: every entry of the merged one,
 * and every merchant's default category on it, moves to the target; a merged parent's children go under the target, which must then be
 * top-level, and one whose name a child of the target already has is merged into that child; the
 * merged category is then deleted. Fails with `CategoryNotFound` or `CategoryRefused` (`itself`,
 * `parent_kind`, `archived` for an archived target, `fallback` for a fallback merged away, itself
 * or as a child merged into the target's child of its name, `third_level` for a parent merged
 * into a child).
 */
export const mergeCategory = (owner: string, categoryId: string, intoId: string) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    let childrenMoved = 0;
    let childrenMerged = 0;

    const change = yield* store.change(
      owner,
      (
        categories,
      ): Result.Result<ReadonlyArray<CategoryStep>, CategoryRefused | CategoryNotFound> =>
        Result.gen(function* () {
          const merged = yield* found(categories, categoryId);
          const into = yield* found(categories, intoId);
          const children = childrenOf(categories, merged.id).toSorted(inOrder);

          if (merged.id === into.id) {
            return yield* refused("itself");
          }

          if (merged.fallback) {
            return yield* fallbackRefused(merged);
          }

          if (merged.kind !== into.kind) {
            return yield* refused("parent_kind");
          }

          if (into.archivedAt !== null) {
            return yield* refused("archived");
          }

          if (children.length > 0 && into.parentId !== null) {
            return yield* refused("third_level");
          }

          const targetChildren = childrenOf(categories, into.id);

          // A child merged into the target's child of its name is deleted: never a fallback.
          const lost = children.find(
            (child) =>
              child.fallback && targetChildren.some((each) => sameText(each.name, child.name)),
          );

          if (lost !== undefined) {
            return yield* fallbackRefused(lost);
          }

          let next = lastPosition(targetChildren);

          const childSteps = children.flatMap((child): ReadonlyArray<CategoryStep> => {
            const same = targetChildren.find((each) => sameText(each.name, child.name));

            if (same === undefined) {
              childrenMoved += 1;
              next += 1;

              return [
                {
                  step: "update",
                  id: child.id,
                  patch: { parentId: into.id, position: Math.min(next - 1, MAX_POSITION) },
                },
              ];
            }

            childrenMerged += 1;

            return [
              { step: "move_entries", from: child.id, into: same.id },
              { step: "move_defaults", from: child.id, into: same.id },
              { step: "delete", id: child.id },
            ];
          });

          return [
            ...childSteps,
            { step: "move_entries", from: merged.id, into: into.id },
            { step: "move_defaults", from: merged.id, into: into.id },
            { step: "delete", id: merged.id },
          ];
        }),
    );

    const into = yield* Effect.fromResult(found(change.categories, intoId));
    const merge: CategoryMerge = { into, childrenMoved, childrenMerged };

    return merge;
  });

/**
 * Archives a category, and a parent's children with it: they keep their entries, and can no longer
 * be chosen. Archiving an archived one changes nothing. Fails with `CategoryNotFound` or
 * `CategoryRefused` (`fallback`: the fallback, or a parent of it).
 */
export const archiveCategory = (owner: string, categoryId: string) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    const now = new Date(yield* Clock.currentTimeMillis).toISOString();

    const change = yield* store.change(
      owner,
      (
        categories,
      ): Result.Result<ReadonlyArray<CategoryStep>, CategoryRefused | CategoryNotFound> =>
        Result.gen(function* () {
          const category = yield* found(categories, categoryId);
          const children = childrenOf(categories, category.id);

          const fallback = [category, ...children].find((each) => each.fallback);

          if (fallback !== undefined) {
            return yield* fallbackRefused(fallback);
          }

          return [category, ...children].flatMap((each): ReadonlyArray<CategoryStep> =>
            each.archivedAt === null
              ? [{ step: "update", id: each.id, patch: { archivedAt: now } }]
              : [],
          );
        }),
    );

    return yield* Effect.fromResult(found(change.categories, categoryId));
  });

/**
 * Brings an archived category back, and a parent's children archived with it (at the same
 * instant); one in use changes nothing. Fails with `CategoryNotFound` or `CategoryRefused`
 * (`parent_archived`: a child whose parent stays archived).
 */
export const restoreCategory = (owner: string, categoryId: string) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;

    const change = yield* store.change(
      owner,
      (
        categories,
      ): Result.Result<ReadonlyArray<CategoryStep>, CategoryRefused | CategoryNotFound> =>
        Result.gen(function* () {
          const category = yield* found(categories, categoryId);
          const parent = categories.find((each) => each.id === category.parentId);

          if (category.archivedAt === null) {
            return [];
          }

          if (parent !== undefined && parent.archivedAt !== null) {
            return yield* refused("parent_archived");
          }

          const withIt = childrenOf(categories, category.id).filter(
            (child) => child.archivedAt === category.archivedAt,
          );

          return [category, ...withIt].map((each): CategoryStep => ({
            step: "update",
            id: each.id,
            patch: { archivedAt: null },
          }));
        }),
    );

    return yield* Effect.fromResult(found(change.categories, categoryId));
  });

/**
 * The category a person names, archived or not: by its name, ignoring case, or by its path,
 * "Parent > Child", and of `kind` when given. A name alone names the top-level category of that
 * name, else the one child of that name, in each kind: so every category can be named, a child
 * sharing a top-level category's name by its path. Fails with `CategoryNameUnknown` (with every
 * category's path) or `CategoryNameAmbiguous` (with the path and kind of each of that name).
 */
export const categoryNamed = (owner: string, name: string, kind?: EntryKind) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    const categories = yield* store.list(owner);
    const ofKind = categories.filter((each) => kind === undefined || each.kind === kind);
    const [first = "", ...rest] = name.split(PATH_SEPARATOR);
    const childName = rest.join(PATH_SEPARATOR);

    const alone = ofKind.filter((each) => sameText(each.name, first));

    const matches =
      rest.length === 0
        ? alone.filter(
            (each) =>
              each.parentId === null ||
              !alone.some((top) => top.parentId === null && top.kind === each.kind),
          )
        : ofKind.filter((each) => {
            const parent = categories.find((candidate) => candidate.id === each.parentId);

            return (
              parent !== undefined && sameText(parent.name, first) && sameText(each.name, childName)
            );
          });

    const [only, ...others] = matches;

    if (only === undefined) {
      return yield* new CategoryNameUnknown({
        name,
        categories: ofKind
          .toSorted(inOrder)
          .map((each) => pathOf(categories, each))
          .toSorted(),
      });
    }

    if (others.length > 0) {
      return yield* new CategoryNameAmbiguous({
        name,
        matches: matches
          .map((each) => ({ path: pathOf(categories, each), kind: each.kind }))
          .toSorted((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind)),
      });
    }

    return only;
  });

/**
 * Sets the category a merchant's entries go in by default: one in use, of either kind (a merchant
 * may be paid or pay, an employer say); null clears it. Archiving the category later keeps it;
 * merging the category moves it to the target. Fails with `MerchantNotFound`, `CategoryNotFound`
 * or `CategoryRefused` (`archived`).
 */
export const setMerchantDefaultCategory = (
  owner: string,
  merchantId: string,
  categoryId: string | null,
) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;

    return yield* store.setMerchantDefault(
      owner,
      merchantId,
      (categories): Result.Result<string | null, CategoryNotFound | CategoryRefused> => {
        if (categoryId === null) {
          return Result.succeed(null);
        }

        return Result.flatMap(found(categories, categoryId), (category) =>
          category.archivedAt === null ? Result.succeed(category.id) : refused("archived"),
        );
      },
    );
  });

/** What a line is put in: a category, or its kind's fallback ("Other") when none is named. */
export type LineClassification =
  | { readonly categoryId: string }
  | { readonly fallbackOf: EntryKind };

/**
 * Puts a line in a category: the category of its one entry, or the fallback of the kind named, as
 * the user's choice, which no rule overwrites unasked (`classified_by = user`). The line's kind
 * follows its sign. Fails with `LineNotFound`, `LineNotClassifiable` (held, discarded or of no
 * amount: no entry; a side of a transfer; a line that pays back a subject; or split), `CategoryNotFound`, `CategoryKindMismatch` or
 * `CategoryRefused` (`archived`).
 */
export const classifyLine = (owner: string, lineId: string, chosen: LineClassification) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;

    const category: LineCategory = yield* store.classifyLine(
      owner,
      lineId,
      (
        facts,
      ): Result.Result<
        { readonly entryId: string; readonly categoryId: string },
        LineNotClassifiable | CategoryNotFound | CategoryKindMismatch | CategoryRefused
      > =>
        Result.gen(function* () {
          const [only, ...others] = facts.entries;

          if (only === undefined) {
            return yield* Result.fail(
              new LineNotClassifiable({
                lineId,
                reason: facts.paired ? "transfer" : facts.paidBack ? "payback" : "no_entry",
              }),
            );
          }

          if (others.length > 0) {
            return yield* Result.fail(new LineNotClassifiable({ lineId, reason: "split" }));
          }

          if ("fallbackOf" in chosen) {
            const fallback = facts.categories.find(
              (each) => each.fallback && each.kind === chosen.fallbackOf,
            );

            if (fallback === undefined) {
              return yield* Result.fail(new CategoryNotFound({ categoryId: "" }));
            }

            if (fallback.kind !== only.kind) {
              return yield* Result.fail(
                new CategoryKindMismatch({
                  lineId,
                  lineKind: only.kind,
                  categoryKind: fallback.kind,
                }),
              );
            }

            return { entryId: only.id, categoryId: fallback.id };
          }

          const category = yield* found(facts.categories, chosen.categoryId);

          if (category.kind !== only.kind) {
            return yield* Result.fail(
              new CategoryKindMismatch({
                lineId,
                lineKind: only.kind,
                categoryKind: category.kind,
              }),
            );
          }

          if (category.archivedAt !== null) {
            return yield* refused("archived");
          }

          return { entryId: only.id, categoryId: category.id };
        }),
    );

    return category;
  });
