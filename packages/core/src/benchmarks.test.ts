import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { memoryId } from "./account-store-memory";
import { monthBenchmarks } from "./benchmarks";
import type { CategoryInMonth } from "./benchmarks";
import type { CategoryRecord } from "./category-store";
import { memoryCategory, memoryCategoryStore } from "./category-store-memory";
import type { MemoryCategoryRows, MemoryPart } from "./category-store-memory";

const ADA = "ada";
const MONTH = "2026-10";

function startingRows() {
  const housing = memoryCategory("expense", "Housing", { position: 0 });
  const rent = memoryCategory("expense", "Rent", { parentId: housing.id });
  const groceries = memoryCategory("expense", "Groceries", { position: 1 });

  const leisure = memoryCategory("expense", "Leisure", {
    position: 2,
    benchmark: { mode: "fixed", minor: 10_000 },
  });

  const gifts = memoryCategory("expense", "Gifts", { position: 3, benchmark: { mode: "none" } });
  const salary = memoryCategory("income", "Salary");

  const rows: MemoryCategoryRows = {
    categories: [housing, rent, groceries, leisure, gifts, salary],
    entries: [],
    lines: [],
  };

  return { rows, housing, rent, groceries, leisure, gifts, salary };
}

/** An entry of the category, on `day`, made of `parts` (one payment in euros by default). */
function spend(
  rows: MemoryCategoryRows,
  category: CategoryRecord,
  day: string,
  minor: number,
  parts: ReadonlyArray<MemoryPart> = [
    { lineId: memoryId(), role: "payment", amountMinor: minor, currency: "EUR" },
  ],
) {
  rows.entries.push({
    id: memoryId(),
    kind: category.kind,
    happenedOn: day,
    categoryId: category.id,
    classifiedBy: "default",
    parts,
  });
}

async function benchmarks(rows: MemoryCategoryRows, month = MONTH, currency = "EUR") {
  return Effect.runPromise(
    monthBenchmarks(ADA, month, currency).pipe(
      Effect.provide(memoryCategoryStore(new Map([[ADA, rows]]))),
    ),
  );
}

function find(rows: ReadonlyArray<CategoryInMonth>, name: string): CategoryInMonth | undefined {
  return rows.flatMap((top) => [top, ...top.children]).find((row) => row.name === name);
}

describe("automatic benchmarks", () => {
  test("average the six months before, a month with nothing in the category counting as 0", async () => {
    const { rows, groceries } = startingRows();

    // Groceries in three of the six months before; the user had expenses in all six.
    spend(rows, groceries, "2026-04-03", 90_000);
    spend(rows, groceries, "2026-05-03", 30_000);
    spend(rows, groceries, "2026-07-12", 30_000);
    spend(rows, groceries, "2026-09-30", 30_000);
    // A month too late for the average: this one.
    spend(rows, groceries, "2026-10-02", 25_000);

    const result = await benchmarks(rows);
    const row = find(result.categories, "Groceries");

    expect(result.averageFrom).toBe("2026-04");
    expect(result.averageTo).toBe("2026-09");
    expect(result.monthsAveraged).toBe(6);
    // 900 + 300 + 300 + 300 over six months.
    expect(row?.benchmark).toEqual({
      mode: "automatic",
      amount: { minor: 30_000, currency: "EUR" },
    });
    expect(row?.spent).toEqual({ minor: 25_000, currency: "EUR" });
    expect(row?.drifts).toBe(false);
  });

  test("a new user's average counts only the months from their first expense on", async () => {
    const { rows, groceries } = startingRows();

    spend(rows, groceries, "2026-08-20", 20_000);
    spend(rows, groceries, "2026-09-10", 30_000);
    spend(rows, groceries, "2026-10-05", 26_000);

    const result = await benchmarks(rows);

    expect(result.monthsAveraged).toBe(2);
    expect(find(result.categories, "Groceries")?.benchmark).toEqual({
      mode: "automatic",
      amount: { minor: 25_000, currency: "EUR" },
    });
    expect(find(result.categories, "Groceries")?.drifts).toBe(true);
  });

  test("with no expense before the month, there is no automatic benchmark, and nothing drifts", async () => {
    const { rows, groceries } = startingRows();

    spend(rows, groceries, "2026-10-05", 26_000);

    const result = await benchmarks(rows);

    expect(result.monthsAveraged).toBe(0);
    expect(find(result.categories, "Groceries")?.benchmark).toEqual({
      mode: "automatic",
      amount: null,
    });
    expect(result.drifting).toEqual([]);
  });

  test("a category with nothing spent in the months before has none yet, and does not drift", async () => {
    const { rows, groceries, rent } = startingRows();

    spend(rows, groceries, "2026-06-10", 30_000);
    spend(rows, rent, "2026-10-01", 70_000);

    const result = await benchmarks(rows);

    // June to September.
    expect(result.monthsAveraged).toBe(4);
    expect(find(result.categories, "Rent")).toMatchObject({
      benchmark: { mode: "automatic", amount: null },
      drifts: false,
    });
    // Groceries had June: nothing this month, under its benchmark.
    expect(find(result.categories, "Groceries")?.benchmark).toEqual({
      mode: "automatic",
      amount: { minor: 7500, currency: "EUR" },
    });
  });

  test("counts each expense at its net cost and a split line's share in each category, never an income", async () => {
    const { rows, groceries, leisure, salary } = startingRows();
    const split = memoryId();

    // A payment of 120 refunded 20.
    spend(rows, groceries, "2026-09-03", 0, [
      { lineId: memoryId(), role: "payment", amountMinor: 12_000, currency: "EUR" },
      { lineId: memoryId(), role: "refund", amountMinor: 2000, currency: "EUR" },
    ]);
    // One line of 80, split: 50 in groceries, 30 in leisure.
    spend(rows, groceries, "2026-10-04", 0, [
      { lineId: split, role: "payment", amountMinor: 5000, currency: "EUR" },
    ]);
    spend(rows, leisure, "2026-10-04", 0, [
      { lineId: split, role: "payment", amountMinor: 3000, currency: "EUR" },
    ]);
    spend(rows, salary, "2026-10-01", 250_000);

    const result = await benchmarks(rows);

    expect(find(result.categories, "Groceries")?.spent.minor).toBe(5000);
    expect(find(result.categories, "Leisure")?.spent.minor).toBe(3000);
    // September's net, 100, the one month from the first expense on.
    expect(find(result.categories, "Groceries")?.benchmark).toEqual({
      mode: "automatic",
      amount: { minor: 10_000, currency: "EUR" },
    });
    expect(find(result.categories, "Salary")).toBeUndefined();
  });
});

describe("what drifts", () => {
  test("a fixed benchmark drifts once passed by any amount, not when reached", async () => {
    const { rows, leisure } = startingRows();

    spend(rows, leisure, "2026-10-04", 10_000);

    expect(find((await benchmarks(rows)).categories, "Leisure")?.drifts).toBe(false);

    spend(rows, leisure, "2026-10-05", 1);

    const result = await benchmarks(rows);

    expect(find(result.categories, "Leisure")).toMatchObject({
      spent: { minor: 10_001, currency: "EUR" },
      benchmark: { mode: "fixed", amount: { minor: 10_000, currency: "EUR" } },
      drifts: true,
    });
    expect(result.drifting.map((row) => row.name)).toEqual(["Leisure"]);
  });

  test("a category without a benchmark never drifts", async () => {
    const { rows, gifts } = startingRows();

    spend(rows, gifts, "2026-10-04", 50_000);

    const result = await benchmarks(rows);

    expect(find(result.categories, "Gifts")).toMatchObject({
      benchmark: { mode: "none" },
      drifts: false,
    });
  });

  test("a top-level category counts its children's spending against its own benchmark", async () => {
    const { rows, housing, rent } = startingRows();

    spend(rows, rent, "2026-09-01", 70_000);
    spend(rows, housing, "2026-09-12", 5000);
    spend(rows, rent, "2026-10-01", 70_000);
    spend(rows, housing, "2026-10-12", 6000);

    const result = await benchmarks(rows);
    const top = find(result.categories, "Housing");

    expect(top?.spent.minor).toBe(76_000);
    expect(top?.benchmark).toEqual({
      mode: "automatic",
      amount: { minor: 75_000, currency: "EUR" },
    });
    expect(top?.drifts).toBe(true);
    expect(top?.children.map((child) => child.name)).toEqual(["Rent"]);
    expect(find(result.categories, "Rent")?.drifts).toBe(false);
    expect(result.drifting.map((row) => row.name)).toEqual(["Housing"]);
  });

  test("spending in another currency is kept apart, never held against the benchmark", async () => {
    const { rows, leisure } = startingRows();

    spend(rows, leisure, "2026-10-04", 0, [
      { lineId: memoryId(), role: "payment", amountMinor: 40_000, currency: "USD" },
    ]);

    const result = await benchmarks(rows);

    expect(find(result.categories, "Leisure")).toMatchObject({
      spent: { minor: 0, currency: "EUR" },
      elsewhere: [{ minor: 40_000, currency: "USD" }],
      drifts: false,
    });
  });

  test("an archived category shows only with spending in the month", async () => {
    const { rows, groceries } = startingRows();
    const old = memoryCategory("expense", "Old club", { archivedAt: "2026-01-01T00:00:00.000Z" });

    const older = memoryCategory("expense", "Older club", {
      archivedAt: "2026-01-01T00:00:00.000Z",
    });

    rows.categories.push(old, older);
    spend(rows, old, "2026-10-04", 1500);
    spend(rows, groceries, "2026-10-04", 1500);

    const result = await benchmarks(rows);

    expect(find(result.categories, "Old club")?.archived).toBe(true);
    expect(find(result.categories, "Older club")).toBeUndefined();
    expect(result.categories.map((row) => row.name)).toContain("Gifts");
  });
});
