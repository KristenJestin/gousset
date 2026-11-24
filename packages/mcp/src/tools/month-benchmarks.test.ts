import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Merchants,
  RuleJobs,
  Subscriptions,
  Today,
  Transfers,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
} from "@gousset/core";
import type { CategoryRecord, MemoryCategoryRows } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { callText, connectInProcess } from "../test-client";

// month benchmarks (#33): each expense category's spending against its benchmark, and what drifts,
// read on 2026-10-20, October under way.

async function month(
  args: { [key: string]: string },
  rows: MemoryCategoryRows = { categories: [], entries: [], lines: [] },
) {
  const client = await connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              memoryAccountStore(),
              memoryLineStore(),
              memoryCategoryStore(new Map([["ada", rows]])),
              Layer.succeed(Today, { day: Effect.succeed("2026-10-20") }),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              Layer.mock(DataExport, {}),
              Layer.mock(Merchants, {}),
              Layer.mock(Transfers, {}),
              Layer.mock(Expenses, {}),
              Layer.mock(UserData, {}),
              Layer.mock(RuleJobs, {}),
              Layer.mock(Subscriptions, {}),
            ),
          ),
        ),
    },
    { userId: "ada", canWrite: false, currency: "EUR" },
    "2025-11-25",
  );

  return callText(client, "month", args);
}

function spend(rows: MemoryCategoryRows, category: CategoryRecord, day: string, minor: number) {
  rows.entries.push({
    id: memoryId(),
    kind: "expense",
    happenedOn: day,
    categoryId: category.id,
    classifiedBy: "default",
    parts: [{ lineId: memoryId(), role: "payment", amountMinor: minor, currency: "EUR" }],
  });
}

/** Six months of groceries at 280, leisure set at 100, gifts without a benchmark. */
function ada() {
  const groceries = memoryCategory("expense", "Groceries", { position: 0 });
  const bakery = memoryCategory("expense", "Bakery", { parentId: groceries.id });

  const leisure = memoryCategory("expense", "Leisure", {
    position: 1,
    benchmark: { mode: "fixed", minor: 10_000 },
  });

  const gifts = memoryCategory("expense", "Gifts", { position: 2, benchmark: { mode: "none" } });

  const rows: MemoryCategoryRows = {
    categories: [groceries, bakery, leisure, gifts],
    entries: [],
    lines: [],
  };

  for (const before of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    spend(rows, groceries, `${before}-10`, 28_000);
  }

  return { rows, groceries, bakery, leisure, gifts };
}

describe("month benchmarks", () => {
  test("says each category's benchmark, spending against it, and what drifts first", async () => {
    const { rows, groceries, bakery, leisure, gifts } = ada();

    spend(rows, groceries, "2026-10-04", 25_000);
    spend(rows, bakery, "2026-10-06", 4000);
    spend(rows, leisure, "2026-10-08", 12_000);
    spend(rows, gifts, "2026-10-09", 6000);

    const { text, isError } = await month({ action: "benchmarks", month: "2026-10" }, rows);

    expect(isError).toBe(false);
    expect(text).toContain("Benchmarks of 2026-10, in EUR");
    expect(text).toContain("6 month(s) of 2026-04 to 2026-09");
    expect(text).toContain(
      "Drifting above their benchmark: Groceries (290.00 EUR, 10.00 EUR above), Leisure (120.00 EUR, 20.00 EUR above).",
    );
    expect(text).toContain(
      "\n- Groceries: spent 290.00 EUR; benchmark 280.00 EUR (automatic); DRIFTS, 10.00 EUR above",
    );
    // Nothing in Bakery in the six months before: nothing to average, nothing drifts.
    expect(text).toContain(
      "\n  - Bakery: spent 40.00 EUR; benchmark: none yet (automatic, nothing spent in it in those months)\n",
    );
    expect(text).toContain(
      "\n- Leisure: spent 120.00 EUR; benchmark 100.00 EUR (set); DRIFTS, 20.00 EUR above",
    );
    expect(text).toContain("\n- Gifts: spent 60.00 EUR; no benchmark");
  });

  test("reads the current month when none is named", async () => {
    const { rows, groceries } = ada();

    spend(rows, groceries, "2026-10-04", 1000);

    const { text } = await month({ action: "benchmarks" }, rows);

    expect(text).toContain("Benchmarks of 2026-10");
    expect(text).toContain("Nothing drifts above its benchmark.");
  });

  test("a new user's automatic benchmark averages the months they have", async () => {
    const groceries = memoryCategory("expense", "Groceries");
    const rows: MemoryCategoryRows = { categories: [groceries], entries: [], lines: [] };

    const { text: none } = await month({ action: "benchmarks", month: "2026-10" }, rows);

    expect(none).toContain("no full month from 2026-04 to 2026-09 holds the user's data");

    spend(rows, groceries, "2026-09-12", 30_000);

    const { text } = await month({ action: "benchmarks", month: "2026-10" }, rows);

    expect(text).toContain("1 month(s) of 2026-04 to 2026-09");
    expect(text).toContain("- Groceries: spent 0.00 EUR; benchmark 300.00 EUR (automatic)");
  });

  test("a month written otherwise is refused with a valid call", async () => {
    const { text, isError } = await month({ action: "benchmarks", month: "October" });

    expect(isError).toBe(true);
    expect(text).toContain("The arguments of month are not valid");
    expect(text).toContain('A valid call: month {"action":"subscriptions"}');
  });
});
