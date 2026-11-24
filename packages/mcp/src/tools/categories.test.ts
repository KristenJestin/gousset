import {
  DataExport,
  Expenses,
  FixtureLedger,
  ImportProfiles,
  Imports,
  Merchants,
  RuleJobs,
  Transfers,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type { CategoryRecord, MemoryCategoryRows, MemoryEntry } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Runner } from "../tool";

// The categories tool through the official client, on an in-memory store of made-up categories
// and entries, as a token allowed to read and write unless said otherwise.

const TODAY = "2026-11-23";
const writer = { userId: "ada", canWrite: true, currency: "EUR" };
const reader = { userId: "ada", canWrite: false, currency: "EUR" };

const housing = memoryCategory("expense", "Housing", { position: 0 });
const rent = memoryCategory("expense", "Rent", { parentId: housing.id });

const energy = memoryCategory("expense", "Energy", {
  parentId: housing.id,
  position: 1,
  benchmark: { mode: "fixed", minor: 8550 },
});

const groceries = memoryCategory("expense", "Groceries", { position: 1 });
const supermarket = memoryCategory("expense", "Supermarket", { parentId: groceries.id });
const bakery = memoryCategory("expense", "Bakery", { parentId: groceries.id, position: 1 });

const family = memoryCategory("expense", "Family", {
  position: 2,
  archivedAt: "2026-11-01T10:00:00.000Z",
  benchmark: { mode: "none" },
});

const other = memoryCategory("expense", "Other", { position: 3, fallback: true });
const salary = memoryCategory("income", "Salary");
const otherIncome = memoryCategory("income", "Other", { position: 1, fallback: true });

function paid(category: CategoryRecord, happenedOn: string, minor: number): MemoryEntry {
  return {
    id: memoryId(),
    kind: category.kind,
    happenedOn,
    categoryId: category.id,
    classifiedBy: "default",
    parts: [{ lineId: memoryId(), role: "payment", amountMinor: minor, currency: "EUR" }],
  };
}

function freshRows(): MemoryCategoryRows {
  return {
    categories: [
      housing,
      rent,
      energy,
      groceries,
      supermarket,
      bakery,
      family,
      other,
      salary,
      otherIncome,
    ],
    entries: [
      // Three months of rent in the six before November: 2,400.00 / 6 = 400.00 a month.
      paid(rent, "2026-08-01", 80_000),
      paid(rent, "2026-09-01", 80_000),
      paid(rent, "2026-10-01", 80_000),
      paid(bakery, "2026-10-10", 1200),
      // Before the six months: counted in the entries, not in the average.
      paid(bakery, "2026-03-10", 600),
    ],
    lines: [],
  };
}

function onToday(rows: Map<string, MemoryCategoryRows>): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    FixtureLedger,
    memoryAccountStore(),
    memoryLineStore(),
    memoryCategoryStore(rows),
    // categories never reaches the imports.
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(Transfers, {}),
    Layer.mock(Expenses, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Merchants, {}),
    TestClock.layer(),
  );

  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(`${TODAY}T12:00:00Z`));

        return yield* effect;
      }).pipe(Effect.provide(layer)),
    );
}

type Arguments = { readonly [key: string]: string | number | boolean };

async function categories(
  args: Arguments,
  rows: Map<string, MemoryCategoryRows> = new Map([[writer.userId, freshRows()]]),
  caller = writer,
) {
  const client = await connectInProcess(
    goussetServer,
    { run: onToday(rows) },
    caller,
    "2025-11-25",
  );

  const result = await client.callTool({ name: "categories", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true, rows };
}

const Written = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);

/** The tool and arguments of the valid call a refusal writes, read back. */
function example(text: string): { tool: string; args: Arguments } | undefined {
  const match = /\nA valid call: (\w+) (.+)$/.exec(text);

  return match === null
    ? undefined
    : {
        tool: match[1] ?? "",
        args: Schema.decodeUnknownSync(Written)(JSON.parse(match[2] ?? "{}")),
      };
}

/** A refusal: under the error limit, with a valid call that answers on the same rows. */
async function expectValidExample(text: string) {
  expect(text.length).toBeLessThan(ERROR_LIMIT);

  const written = example(text);

  expect(written, text).toBeDefined();
  expect(written?.tool).toBe("categories");

  const answered = await categories(written?.args ?? {});

  expect(answered.isError, answered.text).toBe(false);
}

const rowsOf = (rows: Map<string, MemoryCategoryRows>) =>
  rows.get(writer.userId) ?? { categories: [], entries: [], lines: [] };

const named = (rows: Map<string, MemoryCategoryRows>, name: string) =>
  rowsOf(rows).categories.find((each) => each.name === name);

describe("categories list", () => {
  test("gives both trees with entries, benchmark and six-month average, names not ids", async () => {
    const { text, isError } = await categories({ action: "list" }, undefined, reader);

    expect(isError, text).toBe(false);
    expect(text).toContain("monthly average from 2026-05-01 to 2026-10-31");
    expect(text).toContain(
      "Expense categories:\n- Housing: 0 entries; benchmark: the six-month average; average nothing in those months, with its children 400.00 EUR",
    );
    expect(text).toContain(
      "\n  - Rent: 3 entries; benchmark: the six-month average; average 400.00 EUR a month",
    );
    expect(text).toContain("\n  - Energy: 0 entries; benchmark: 85.50 EUR a month;");
    expect(text).toContain(
      "\n  - Bakery: 2 entries; benchmark: the six-month average; average 2.00 EUR a month",
    );
    expect(text).toContain("\n- Other (fallback: unclassified lines go here): 0 entries;");
    expect(text).toContain("Income categories:\n- Salary: 0 entries;");
    // Archived ones only when asked; never an id.
    expect(text).not.toContain("Family");
    expect(text).not.toContain(rent.id);
  });

  test("adds the archived categories when asked, marked, and keeps to one kind", async () => {
    const { text } = await categories({ action: "list", archived: true, kind: "expense" });

    expect(text).toContain("\n- Family (archived on 2026-11-01): 0 entries; no benchmark;");
    expect(text).not.toContain("Income categories");
  });
});

describe("categories create and edit", () => {
  test("creates a child under a top-level category, with a fixed benchmark", async () => {
    const { text, isError, rows } = await categories({
      action: "create",
      name: "Water",
      parent: "housing",
      benchmark: "30",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      'Created the expense category "Housing > Water", benchmark: 30.00 EUR a month.',
    );
    expect(named(rows, "Water")).toMatchObject({
      parentId: housing.id,
      kind: "expense",
      benchmark: { mode: "fixed", minor: 3000 },
    });
  });

  test("reads and writes a fixed benchmark in the user's currency", async () => {
    const inDollars = { ...writer, currency: "USD" };
    const rows = new Map([[writer.userId, freshRows()]]);
    const listed = await categories({ action: "list" }, rows, inDollars);

    expect(listed.text).toContain("\n  - Energy: 0 entries; benchmark: 85.50 USD a month;");

    const created = await categories(
      { action: "create", name: "Water", parent: "Housing", benchmark: "30" },
      rows,
      inDollars,
    );

    expect(created.isError, created.text).toBe(false);
    expect(created.text).toContain("benchmark: 30.00 USD a month.");
    expect(named(rows, "Water")?.benchmark).toEqual({ mode: "fixed", minor: 3000 });

    const refused = await categories(
      { action: "edit", category: "Rent", benchmark: "12.5" },
      rows,
      { ...writer, currency: "JPY" },
    );

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain(
      "a fixed amount a month in JPY, a decimal from 0 with at most 0 decimals",
    );
  });

  test("takes its parent's kind when kind is left out", async () => {
    const { text, rows } = await categories({ action: "create", name: "Bonus", parent: "Salary" });

    expect(text).toContain('Created the income category "Salary > Bonus"');
    expect(named(rows, "Bonus")?.kind).toBe("income");
  });

  test("refuses a third level, with a call under the top-level category", async () => {
    const { text, isError, rows } = await categories({
      action: "create",
      name: "Deposit",
      parent: "Housing > Rent",
    });

    expect(isError).toBe(true);
    expect(text).toContain("Categories have two levels");
    expect(text).toContain('"Housing > Rent" is a child, under "Housing"');
    expect(example(text)?.args).toEqual({ action: "create", name: "Deposit", parent: "Housing" });
    expect(named(rows, "Deposit")).toBeUndefined();
    await expectValidExample(text);
  });

  test("refuses a parent of the other kind, a name taken, a name with >", async () => {
    const kind = await categories({
      action: "create",
      name: "Tips",
      kind: "expense",
      parent: "Salary",
    });

    expect(kind.isError).toBe(true);
    // Salary is no expense category: it is not found among them.
    expect(kind.text).toContain('No expense category of the user\'s is named "Salary"');
    await expectValidExample(kind.text);

    const moved = await categories({ action: "edit", category: "Bakery", parent: "Salary" });

    expect(moved.isError).toBe(true);
    expect(moved.text).toContain('No expense category of the user\'s is named "Salary"');

    const taken = await categories({ action: "create", name: "rent", parent: "Housing" });

    expect(taken.isError).toBe(true);
    expect(taken.text).toContain('already has the name "rent"');
    await expectValidExample(taken.text);

    const arrow = await categories({ action: "create", name: "Car > Fuel" });

    expect(arrow.isError).toBe(true);
    expect(arrow.text).toContain('no ">"');
    await expectValidExample(arrow.text);
  });

  test("renames, moves and sets a benchmark", async () => {
    const { text, isError, rows } = await categories({
      action: "edit",
      category: "Groceries > Bakery",
      name: "Bakeries",
      parent: "Housing",
      benchmark: "none",
    });

    expect(isError, text).toBe(false);
    expect(text).toBe(
      '"Groceries > Bakery" is now "Housing > Bakeries", expense category, no benchmark.',
    );
    expect(named(rows, "Bakeries")).toMatchObject({
      parentId: housing.id,
      benchmark: { mode: "none" },
    });

    const top = await categories(
      { action: "edit", category: "Supermarket", top_level: true },
      rows,
    );

    expect(top.text).toContain('"Groceries > Supermarket" is now "Supermarket"');
  });

  test("refuses a benchmark that is no decimal from 0, with a valid call", async () => {
    for (const benchmark of ["-5", "12.345", "lots"]) {
      const { text, isError } = await categories({ action: "edit", category: "Rent", benchmark });

      expect(isError, benchmark).toBe(true);
      expect(text).toContain("a decimal from 0 with at most 2 decimals");
      await expectValidExample(text);
    }
  });

  test("tells apart two categories of the same name by kind", async () => {
    const { text, isError } = await categories({
      action: "edit",
      category: "Other",
      benchmark: "none",
    });

    expect(isError).toBe(true);
    expect(text).toContain("Add kind, expense or income");
    expect(example(text)?.args).toMatchObject({ category: "Other", kind: "expense" });
    await expectValidExample(text);
  });

  test("a name alone is the top-level category of that name, the child's is its path", async () => {
    const fresh = freshRows();
    const travel = memoryCategory("expense", "Travel", { position: 4 });
    const leisure = memoryCategory("expense", "Leisure", { position: 5 });
    const leisureTravel = memoryCategory("expense", "Travel", { parentId: leisure.id });

    fresh.categories.push(travel, leisure, leisureTravel);

    const rows = new Map([[writer.userId, fresh]]);
    const top = await categories({ action: "archive", category: "Travel" }, rows);

    expect(top.isError, top.text).toBe(false);
    expect(top.text).toContain('Archived "Travel"');

    const archived = (id: string) =>
      rowsOf(rows).categories.find((each) => each.id === id)?.archivedAt;

    expect(archived(travel.id)).not.toBeNull();
    expect(archived(leisureTravel.id)).toBeNull();

    const child = await categories({ action: "archive", category: "Leisure > Travel" }, rows);

    expect(child.text).toContain('Archived "Leisure > Travel"');
    expect(archived(leisureTravel.id)).not.toBeNull();
  });

  test("children of one name under two parents: the refusal names each by its path", async () => {
    const fresh = freshRows();

    fresh.categories.push(
      memoryCategory("expense", "Fees", { parentId: housing.id, position: 2 }),
      memoryCategory("expense", "Fees", { parentId: groceries.id, position: 2 }),
    );

    const rows = new Map([[writer.userId, fresh]]);
    const { text, isError } = await categories({ action: "archive", category: "fees" }, rows);

    expect(isError).toBe(true);
    expect(text).toContain('named "fees": Groceries > Fees, Housing > Fees.');

    const written = example(text);

    expect(written?.args).toEqual({
      action: "archive",
      category: "Groceries > Fees",
      kind: "expense",
    });

    const again = await categories(written?.args ?? {}, rows);

    expect(again.isError, again.text).toBe(false);
  });

  test("refuses an unknown name with the user's categories", async () => {
    const { text, isError } = await categories({ action: "edit", category: "Rnet", name: "Rent" });

    expect(isError).toBe(true);
    expect(text).toContain('named "Rnet". Their categories:');
    expect(text).toContain("Housing > Rent");
    await expectValidExample(text);
  });
});

describe("categories merge and archive", () => {
  test("merging moves every expense, then the category is gone", async () => {
    const { text, isError, rows } = await categories({
      action: "merge",
      category: "Bakery",
      into: "Groceries",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain('Merged "Groceries > Bakery" into "Groceries"');
    expect(named(rows, "Bakery")).toBeUndefined();

    const bakeryEntries = rowsOf(rows).entries.filter((each) => each.categoryId === bakery.id);

    const groceriesEntries = rowsOf(rows).entries.filter(
      (each) => each.categoryId === groceries.id,
    );

    expect(bakeryEntries).toEqual([]);
    expect(groceriesEntries).toHaveLength(2);
  });

  test("refuses merging a parent into a child, or the fallback away", async () => {
    const child = await categories({ action: "merge", category: "Housing", into: "Supermarket" });

    expect(child.isError).toBe(true);
    expect(child.text).toContain('"Supermarket" is a child, under "Groceries"');
    await expectValidExample(child.text);

    const fallback = await categories({
      action: "merge",
      category: "Other",
      kind: "expense",
      into: "Groceries",
    });

    expect(fallback.isError).toBe(true);
    expect(fallback.text).toContain("fallback");
    await expectValidExample(fallback.text);
  });

  test("archiving keeps the history; restore brings it back", async () => {
    const { text, isError, rows } = await categories({ action: "archive", category: "Groceries" });

    expect(isError, text).toBe(false);
    expect(text).toContain('Archived "Groceries" and its children');
    expect(text).toContain(
      'Bring it back with: categories {"action":"archive","category":"Groceries","kind":"expense","restore":true}',
    );
    expect(named(rows, "Bakery")?.archivedAt).not.toBeNull();
    // Its entries keep it.
    expect(rowsOf(rows).entries.filter((each) => each.categoryId === bakery.id)).toHaveLength(2);

    const listed = await categories({ action: "list", archived: true }, rows);

    expect(listed.text).toMatch(/\n {2}- Bakery \(archived on \d{4}-\d\d-\d\d\): 2 entries;/);

    // An archived category is no parent.
    const under = await categories(
      { action: "create", name: "Organic", parent: "Groceries" },
      rows,
    );

    expect(under.isError).toBe(true);
    expect(under.text).toContain('"Groceries" is archived');

    const restored = await categories(
      { action: "archive", category: "Groceries", restore: true },
      rows,
    );

    expect(restored.text).toContain('Restored "Groceries"');
    expect(named(rows, "Bakery")?.archivedAt).toBeNull();
  });

  test("refuses archiving the fallback", async () => {
    const { text, isError } = await categories({
      action: "archive",
      category: "Other",
      kind: "income",
    });

    expect(isError).toBe(true);
    expect(text).toContain("cannot be archived");
    await expectValidExample(text);
  });

  test("names the user's fallback as they called it, never a literal Other", async () => {
    const fresh = freshRows();

    fresh.categories = fresh.categories.map((each) =>
      each.id === other.id ? { ...each, name: "Unsorted" } : each,
    );

    const rows = new Map([[writer.userId, fresh]]);
    const { text, isError } = await categories({ action: "archive", category: "Unsorted" }, rows);

    expect(isError).toBe(true);
    expect(text).toContain('"Unsorted" is the user\'s expense fallback');
    expect(text).not.toContain("Other");
  });

  test("refuses merging a parent whose child, the fallback, would be merged away", async () => {
    const fresh = freshRows();

    fresh.categories = fresh.categories.map((each) =>
      each.id === other.id ? { ...each, parentId: housing.id, position: 2 } : each,
    );
    fresh.categories.push(
      memoryCategory("expense", "Other", { parentId: groceries.id, position: 2 }),
    );

    const rows = new Map([[writer.userId, fresh]]);

    const { text, isError } = await categories(
      { action: "merge", category: "Housing", into: "Groceries" },
      rows,
    );

    expect(isError).toBe(true);
    expect(text).toContain('"Other" is the user\'s expense fallback');
    expect(named(rows, "Housing")).toBeDefined();
    expect(example(text)?.args).toEqual({
      action: "edit",
      category: "Housing > Other",
      kind: "expense",
      top_level: true,
    });

    const moved = await categories(example(text)?.args ?? {}, rows);

    expect(moved.isError, moved.text).toBe(false);

    const merged = await categories(
      { action: "merge", category: "Housing", into: "Groceries" },
      rows,
    );

    expect(merged.isError, merged.text).toBe(false);
    expect(rowsOf(rows).categories.find((each) => each.id === other.id)?.fallback).toBe(true);
  });
});

describe("the categories tool", () => {
  test("refuses a write to a read-only token, saying how to get write", async () => {
    const { text, isError, rows } = await categories(
      { action: "create", name: "Water", parent: "Housing" },
      undefined,
      reader,
    );

    expect(isError).toBe(true);
    expect(text).toContain("choose Read and write on Gousset's consent page");
    expect(named(rows, "Water")).toBeUndefined();
  });

  test("asks for what an action needs", async () => {
    for (const action of ["create", "edit", "merge", "archive"]) {
      const { text, isError } = await categories({ action });

      expect(isError, action).toBe(true);
      expect(text).toContain(`${action} needs`);
      expect(example(text)?.args.action).toBe(action);
    }
  });

  test("writes, says so, after merchants in the fixed order", async () => {
    const client = await connectInProcess(
      goussetServer,
      { run: onToday(new Map()) },
      reader,
      "2026-07-28",
    );

    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "categories");

    expect(tools.map((each) => each.name)).toEqual([
      "month",
      "imports",
      "accounts",
      "data",
      "lines",
      "merchants",
      "categories",
      "rules",
    ]);
    expect(tool?.title).toBe("Categories");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
