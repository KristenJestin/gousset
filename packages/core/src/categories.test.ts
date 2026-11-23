import { Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { memoryId } from "./account-store-memory";
import {
  archiveCategory,
  categoryNamed,
  classifyLine,
  createCategory,
  editCategory,
  listCategories,
  MAX_CATEGORIES,
  mergeCategory,
  restoreCategory,
} from "./categories";
import type { CategoryStore, CategoryRecord, EntryKind } from "./category-store";
import { memoryCategory, memoryCategoryStore } from "./category-store-memory";
import type { MemoryCategoryRows, MemoryEntry } from "./category-store-memory";

const TODAY = "2026-11-23";
const ADA = "ada";

/** Ada's rows: what the default set gives, in short, with each kind's fallback. */
function startingRows() {
  const housing = memoryCategory("expense", "Housing", { position: 0 });
  const rent = memoryCategory("expense", "Rent", { parentId: housing.id });
  const energy = memoryCategory("expense", "Energy", { parentId: housing.id, position: 1 });
  const groceries = memoryCategory("expense", "Groceries", { position: 1 });
  const bakery = memoryCategory("expense", "Bakery", { parentId: groceries.id });
  const other = memoryCategory("expense", "Other", { position: 2, fallback: true });
  const salary = memoryCategory("income", "Salary");
  const otherIncome = memoryCategory("income", "Other", { position: 1, fallback: true });

  const rows: MemoryCategoryRows = {
    categories: [housing, rent, energy, groceries, bakery, other, salary, otherIncome],
    entries: [],
    lines: [],
  };

  return { rows, housing, rent, energy, groceries, bakery, other, salary, otherIncome };
}

/** An entry of one payment line, in euros. */
function entryIn(
  rows: MemoryCategoryRows,
  category: CategoryRecord,
  happenedOn: string,
  minor: number,
): MemoryEntry {
  const lineId = memoryId();
  const kind: EntryKind = category.kind;

  const made: MemoryEntry = {
    id: memoryId(),
    kind,
    happenedOn,
    categoryId: category.id,
    classifiedBy: "default",
    parts: [{ lineId, role: "payment", amountMinor: minor, currency: "EUR" }],
  };

  rows.entries.push(made);
  rows.lines.push({ id: lineId, amountMinor: kind === "expense" ? -minor : minor });

  return made;
}

/** Runs `effect` today, on Ada's rows, which it changes in place; gives the rows as left. */
async function run<A, E>(rows: MemoryCategoryRows, effect: Effect.Effect<A, E, CategoryStore>) {
  const store = new Map([[ADA, rows]]);
  const layer = Layer.mergeAll(memoryCategoryStore(store), TestClock.layer());

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

      return yield* Effect.result(effect);
    }).pipe(Effect.provide(layer)),
  );

  return { result, rows: store.get(ADA) ?? rows };
}

/** The error's tag and reason, or "succeeded". */
async function outcome<A, E extends { readonly _tag: string; readonly reason?: string }>(
  rows: MemoryCategoryRows,
  effect: Effect.Effect<A, E, CategoryStore>,
): Promise<string> {
  const { result } = await run(rows, effect);

  return Result.match(result, {
    onSuccess: () => "succeeded",
    onFailure: (error) =>
      error.reason === undefined ? error._tag : `${error._tag}:${error.reason}`,
  });
}

describe("two levels", () => {
  test("a third level is refused", async () => {
    const { rows, housing, rent, groceries, bakery } = startingRows();

    // Under a child.
    expect(
      await outcome(
        rows,
        createCategory(ADA, { kind: "expense", name: "Deposit", parentId: rent.id }),
      ),
    ).toBe("CategoryRefused:third_level");

    // A parent with children moved under another parent.
    expect(await outcome(rows, editCategory(ADA, groceries.id, { parentId: housing.id }))).toBe(
      "CategoryRefused:third_level",
    );

    // A category moved under a child.
    expect(await outcome(rows, editCategory(ADA, bakery.id, { parentId: rent.id }))).toBe(
      "CategoryRefused:third_level",
    );
  });

  test("a child goes under a top-level category of its kind, in use, last among its siblings", async () => {
    const { rows, housing, salary, bakery } = startingRows();

    const { result, rows: after } = await run(
      rows,
      createCategory(ADA, { kind: "expense", name: "  Water  ", parentId: housing.id }),
    );

    expect(Result.isSuccess(result)).toBe(true);

    const water = after.categories.find((each) => each.name === "Water");

    expect(water?.parentId).toBe(housing.id);
    expect(water?.position).toBe(2);

    expect(
      await outcome(
        rows,
        createCategory(ADA, { kind: "expense", name: "Bonus", parentId: salary.id }),
      ),
    ).toBe("CategoryRefused:parent_kind");

    // A child moved to the top, and back under a parent.
    const { rows: moved } = await run(rows, editCategory(ADA, bakery.id, { parentId: null }));

    expect(moved.categories.find((each) => each.id === bakery.id)?.parentId).toBeNull();
  });

  test("sibling names are unique in any case, across levels they may repeat", async () => {
    const { rows, housing, groceries } = startingRows();

    expect(
      await outcome(
        rows,
        createCategory(ADA, { kind: "expense", name: "rent", parentId: housing.id }),
      ),
    ).toBe("CategoryNameTaken");

    expect(
      await outcome(
        rows,
        createCategory(ADA, { kind: "expense", name: "Rent", parentId: groceries.id }),
      ),
    ).toBe("succeeded");

    // An income "Groceries" and an expense one may both exist.
    expect(await outcome(rows, createCategory(ADA, { kind: "income", name: "Groceries" }))).toBe(
      "succeeded",
    );
  });

  test("names are trimmed, 1 to 100 characters, without `>`", async () => {
    const { rows } = startingRows();

    for (const name of ["   ", "a".repeat(101), "Home > Garden"]) {
      expect(await outcome(rows, createCategory(ADA, { kind: "expense", name }))).toBe(
        "CategoryRefused:name",
      );
    }

    expect(
      await outcome(rows, createCategory(ADA, { kind: "expense", name: "a".repeat(100) })),
    ).toBe("succeeded");
  });

  test("a user has 300 categories at most", async () => {
    const { rows } = startingRows();

    while (rows.categories.length < MAX_CATEGORIES) {
      rows.categories.push(memoryCategory("expense", `Made ${rows.categories.length}`));
    }

    expect(await outcome(rows, createCategory(ADA, { kind: "expense", name: "One more" }))).toBe(
      "CategoryRefused:too_many",
    );
  });

  test("a benchmark is automatic, fixed in whole minor units from 0, or none", async () => {
    const { rows, rent } = startingRows();

    expect(
      await outcome(rows, editCategory(ADA, rent.id, { benchmark: { mode: "fixed", minor: -1 } })),
    ).toBe("CategoryRefused:benchmark");

    const { rows: after } = await run(
      rows,
      editCategory(ADA, rent.id, { benchmark: { mode: "fixed", minor: 85_000 } }),
    );

    expect(after.categories.find((each) => each.id === rent.id)?.benchmark).toEqual({
      mode: "fixed",
      minor: 85_000,
    });
  });
});

describe("merging", () => {
  test("merging moves every expense", async () => {
    const { rows, bakery, groceries } = startingRows();

    const moved = [
      entryIn(rows, bakery, "2026-09-02", 420),
      entryIn(rows, bakery, "2026-10-12", 380),
      entryIn(rows, bakery, "2026-11-03", 510),
    ];

    const kept = entryIn(rows, groceries, "2026-10-01", 6250);
    const { result, rows: after } = await run(rows, mergeCategory(ADA, bakery.id, groceries.id));

    expect(Result.isSuccess(result)).toBe(true);
    expect(after.categories.some((each) => each.id === bakery.id)).toBe(false);

    for (const entry of [...moved, kept]) {
      expect(after.entries.find((each) => each.id === entry.id)?.categoryId).toBe(groceries.id);
    }

    expect(after.entries).toHaveLength(4);
  });

  test("a merged parent's children go under the target, merged into a child of the same name", async () => {
    const { rows, housing, rent, energy } = startingRows();
    const home = memoryCategory("expense", "Home", { position: 5 });
    const homeEnergy = memoryCategory("expense", "energy", { parentId: home.id });

    rows.categories.push(home, homeEnergy);

    const paid = entryIn(rows, energy, "2026-10-04", 7300);
    const inHousing = entryIn(rows, housing, "2026-10-05", 1000);
    const { result, rows: after } = await run(rows, mergeCategory(ADA, housing.id, home.id));

    expect(result).toMatchObject({ success: { childrenMoved: 1, childrenMerged: 1 } });
    expect(after.categories.find((each) => each.id === rent.id)?.parentId).toBe(home.id);
    expect(after.categories.some((each) => each.id === energy.id)).toBe(false);
    expect(after.entries.find((each) => each.id === paid.id)?.categoryId).toBe(homeEnergy.id);
    expect(after.entries.find((each) => each.id === inHousing.id)?.categoryId).toBe(home.id);
  });

  test("a parent is not merged into a child, nor a category into one of the other kind", async () => {
    const { rows, housing, bakery, salary } = startingRows();

    expect(await outcome(rows, mergeCategory(ADA, housing.id, bakery.id))).toBe(
      "CategoryRefused:third_level",
    );
    expect(await outcome(rows, mergeCategory(ADA, bakery.id, salary.id))).toBe(
      "CategoryRefused:parent_kind",
    );
    expect(await outcome(rows, mergeCategory(ADA, bakery.id, bakery.id))).toBe(
      "CategoryRefused:itself",
    );
  });
});

describe("archiving", () => {
  test("archiving keeps the history", async () => {
    const { rows, housing, rent, energy } = startingRows();
    const paid = entryIn(rows, rent, "2026-10-01", 85_000);
    const { rows: after } = await run(rows, archiveCategory(ADA, housing.id));

    // The parent and its children are archived; the entry keeps its category.
    for (const id of [housing.id, rent.id, energy.id]) {
      expect(after.categories.find((each) => each.id === id)?.archivedAt).toBe(
        "2026-11-23T12:00:00.000Z",
      );
    }

    expect(after.entries.find((each) => each.id === paid.id)?.categoryId).toBe(rent.id);

    // Listed only when asked, with its entries.
    const { result: listed } = await run(after, listCategories(ADA));
    const { result: all } = await run(after, listCategories(ADA, { archived: true }));

    expect(listed).toMatchObject({
      success: { expense: [{ name: "Groceries" }, { name: "Other" }] },
    });
    expect(all).toMatchObject({
      success: {
        expense: [{ name: "Housing", children: [{ name: "Rent", entries: 1 }, {}] }, {}, {}],
      },
    });

    // An archived category can no longer be chosen.
    expect(
      await outcome(
        after,
        createCategory(ADA, { kind: "expense", name: "Water", parentId: housing.id }),
      ),
    ).toBe("CategoryRefused:archived");

    // Restored, it comes back with the children archived with it.
    const { rows: restored } = await run(after, restoreCategory(ADA, housing.id));

    expect(restored.categories.filter((each) => each.archivedAt !== null)).toEqual([]);
  });

  test("a child is not restored while its parent stays archived", async () => {
    const { rows, housing, rent } = startingRows();
    const { rows: after } = await run(rows, archiveCategory(ADA, housing.id));

    expect(await outcome(after, restoreCategory(ADA, rent.id))).toBe(
      "CategoryRefused:parent_archived",
    );
  });
});

describe("the fallback", () => {
  test("the fallback can't be archived or merged away", async () => {
    const { rows, other, groceries } = startingRows();

    expect(await outcome(rows, archiveCategory(ADA, other.id))).toBe("CategoryRefused:fallback");
    expect(await outcome(rows, mergeCategory(ADA, other.id, groceries.id))).toBe(
      "CategoryRefused:fallback",
    );

    // Something may be merged into it.
    expect(await outcome(rows, mergeCategory(ADA, groceries.id, other.id))).toBe("succeeded");
  });

  test("the fallback may be renamed and put under a parent; that parent is then not archived", async () => {
    const { rows, other, housing } = startingRows();

    const { rows: after } = await run(
      rows,
      editCategory(ADA, other.id, { name: "Unsorted", parentId: housing.id }),
    );

    expect(after.categories.find((each) => each.id === other.id)).toMatchObject({
      name: "Unsorted",
      parentId: housing.id,
      fallback: true,
    });

    expect(await outcome(after, archiveCategory(ADA, housing.id))).toBe("CategoryRefused:fallback");
  });

  test("a parent is not merged when its child the fallback would be merged away", async () => {
    const { rows, other, housing, groceries } = startingRows();
    const { rows: moved } = await run(rows, editCategory(ADA, other.id, { parentId: housing.id }));

    const { rows: twin } = await run(
      moved,
      createCategory(ADA, { kind: "expense", name: "Other", parentId: groceries.id }),
    );

    const { result, rows: after } = await run(twin, mergeCategory(ADA, housing.id, groceries.id));

    expect(result).toMatchObject({
      failure: { _tag: "CategoryRefused", reason: "fallback", fallback: "Other" },
    });
    expect(after.categories.find((each) => each.id === other.id)?.fallback).toBe(true);

    // Merged the other way, the fallback's parent keeps it: the twin goes into the fallback.
    const { result: kept, rows: left } = await run(
      twin,
      mergeCategory(ADA, groceries.id, housing.id),
    );

    expect(kept).toMatchObject({ success: { childrenMerged: 1 } });
    expect(left.categories.find((each) => each.id === other.id)?.fallback).toBe(true);
  });

  test("a refusal for the fallback names it as the user called it", async () => {
    const { rows, other, groceries } = startingRows();
    const { rows: renamed } = await run(rows, editCategory(ADA, other.id, { name: "Unsorted" }));
    const { result } = await run(renamed, mergeCategory(ADA, other.id, groceries.id));

    expect(result).toMatchObject({ failure: { reason: "fallback", fallback: "Unsorted" } });
  });
});

describe("listing", () => {
  test("each category with its entries and the average of the six full months before this one", async () => {
    const { rows, bakery, groceries } = startingRows();

    entryIn(rows, bakery, "2026-04-30", 9999); // Before the six months.
    entryIn(rows, bakery, "2026-05-31", 600);
    entryIn(rows, bakery, "2026-10-31", 600);
    entryIn(rows, bakery, "2026-11-02", 9999); // This month.

    const refunded = entryIn(rows, groceries, "2026-08-10", 1200);

    rows.entries[rows.entries.indexOf(refunded)] = {
      ...refunded,
      parts: [
        ...refunded.parts,
        { lineId: memoryId(), role: "refund", amountMinor: 600, currency: "EUR" },
      ],
    };

    const { result } = await run(rows, listCategories(ADA));

    expect(result).toMatchObject({
      success: {
        averageFrom: "2026-05-01",
        averageTo: "2026-10-31",
        expense: [
          {},
          {
            name: "Groceries",
            entries: 1,
            average: [{ currency: "EUR", minor: 100 }],
            averageWithChildren: [{ currency: "EUR", minor: 300 }],
            children: [{ name: "Bakery", entries: 4, average: [{ currency: "EUR", minor: 200 }] }],
          },
          { name: "Other", fallback: true },
        ],
      },
    });
  });
});

describe("naming", () => {
  test("a category is found by its name or its path, in any case", async () => {
    const { rows, rent, other, otherIncome } = startingRows();

    expect(await run(rows, categoryNamed(ADA, "rent"))).toMatchObject({
      result: { success: { id: rent.id } },
    });
    expect(await run(rows, categoryNamed(ADA, "Housing > RENT"))).toMatchObject({
      result: { success: { id: rent.id } },
    });
    expect(await run(rows, categoryNamed(ADA, "Other", "income"))).toMatchObject({
      result: { success: { id: otherIncome.id } },
    });

    expect(await outcome(rows, categoryNamed(ADA, "other"))).toBe("CategoryNameAmbiguous");
    expect(await outcome(rows, categoryNamed(ADA, "Rnet"))).toBe("CategoryNameUnknown");

    const { result: ambiguous } = await run(rows, categoryNamed(ADA, "other"));

    expect(ambiguous).toMatchObject({
      failure: {
        matches: [
          { path: "Other", kind: "expense" },
          { path: "Other", kind: "income" },
        ],
      },
    });

    const { result: unknown } = await run(rows, categoryNamed(ADA, "Rnet", "expense"));

    expect(unknown).toMatchObject({
      failure: { categories: expect.arrayContaining(["Housing > Rent", other.name]) },
    });
  });

  test("a name alone names the top-level category of that name, else its one child", async () => {
    const { rows } = startingRows();
    const travel = memoryCategory("expense", "Travel", { position: 3 });
    const leisure = memoryCategory("expense", "Leisure", { position: 4 });
    const leisureTravel = memoryCategory("expense", "Travel", { parentId: leisure.id });

    rows.categories.push(travel, leisure, leisureTravel);

    expect(await run(rows, categoryNamed(ADA, "travel", "expense"))).toMatchObject({
      result: { success: { id: travel.id } },
    });
    expect(await run(rows, categoryNamed(ADA, "Travel"))).toMatchObject({
      result: { success: { id: travel.id } },
    });
    expect(await run(rows, categoryNamed(ADA, "Leisure > Travel"))).toMatchObject({
      result: { success: { id: leisureTravel.id } },
    });
  });

  test("children of the same name under different parents are each named by their path", async () => {
    const { rows, housing, groceries } = startingRows();
    const housingFees = memoryCategory("expense", "Fees", { parentId: housing.id, position: 2 });
    const groceriesFees = memoryCategory("expense", "Fees", { parentId: groceries.id });

    rows.categories.push(housingFees, groceriesFees);

    const { result } = await run(rows, categoryNamed(ADA, "fees"));

    expect(result).toMatchObject({
      failure: {
        _tag: "CategoryNameAmbiguous",
        matches: [
          { path: "Groceries > Fees", kind: "expense" },
          { path: "Housing > Fees", kind: "expense" },
        ],
      },
    });
    expect(await run(rows, categoryNamed(ADA, "Groceries > Fees"))).toMatchObject({
      result: { success: { id: groceriesFees.id } },
    });
  });
});

describe("classifying a line", () => {
  test("the line's one entry takes the category, as the user's choice", async () => {
    const { rows, bakery, other, salary } = startingRows();
    const paid = entryIn(rows, other, "2026-11-02", 420);
    const lineId = paid.parts[0]?.lineId ?? "";

    const { result, rows: after } = await run(
      rows,
      classifyLine(ADA, lineId, { categoryId: bakery.id }),
    );

    expect(result).toMatchObject({
      success: { id: bakery.id, name: "Bakery", parentName: "Groceries", kind: "expense" },
    });
    expect(after.entries.find((each) => each.id === paid.id)).toMatchObject({
      categoryId: bakery.id,
      classifiedBy: "user",
    });

    // Money out is an expense: an income category is refused.
    expect(await outcome(after, classifyLine(ADA, lineId, { categoryId: salary.id }))).toBe(
      "CategoryKindMismatch",
    );
  });

  test("with no category named, the line goes to its kind's fallback, as the user's choice", async () => {
    const { rows, bakery, other } = startingRows();
    const paid = entryIn(rows, bakery, "2026-11-03", 380);
    const lineId = paid.parts[0]?.lineId ?? "";

    const { result, rows: after } = await run(
      rows,
      classifyLine(ADA, lineId, { fallbackOf: "expense" }),
    );

    expect(result).toMatchObject({ success: { id: other.id, kind: "expense" } });
    expect(after.entries.find((each) => each.id === paid.id)).toMatchObject({
      categoryId: other.id,
      classifiedBy: "user",
    });

    // Money out is no income.
    expect(await outcome(after, classifyLine(ADA, lineId, { fallbackOf: "income" }))).toBe(
      "CategoryKindMismatch",
    );
  });

  test("a line with no entry, or of another user, is not classified", async () => {
    const { rows, bakery } = startingRows();
    const held = memoryId();

    rows.lines.push({ id: held, amountMinor: -100 });

    expect(await outcome(rows, classifyLine(ADA, held, { categoryId: bakery.id }))).toBe(
      "LineNotClassifiable:no_entry",
    );
    expect(await outcome(rows, classifyLine(ADA, memoryId(), { categoryId: bakery.id }))).toBe(
      "LineNotFound",
    );
  });

  test("a side of a transfer is no expense nor income: it is not classified", async () => {
    const { rows, bakery } = startingRows();
    const side = memoryId();

    rows.lines.push({ id: side, amountMinor: -25_000, paired: true });

    expect(await outcome(rows, classifyLine(ADA, side, { categoryId: bakery.id }))).toBe(
      "LineNotClassifiable:transfer",
    );
  });
});
