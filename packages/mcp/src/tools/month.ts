import { Month, currentMonth, monthBenchmarks } from "@gousset/core";
import type { CategoryInMonth, CategoryStore, MonthBenchmarks } from "@gousset/core";
import { Effect, Schema } from "effect";

import { defineTool } from "../tool";
import { amount } from "./accounts";
import { benchmarkCurrency } from "./categories";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["benchmarks", "summary", "review", "days"]).annotate({
    description:
      "benchmarks: each expense category's spending in the month against its benchmark, and what drifts above it. summary, review, days: the review's actions to come, which answer that they are not available yet.",
  }),
  month: Schema.optional(
    Month.annotate({ description: "benchmarks: the month, YYYY-MM; the current one if left out." }),
  ),
});

type MonthInput = typeof MonthInput.Type;

const DESCRIPTION = `The monthly review. \`benchmarks\` gives, for a month (the current one by default), every expense category's spending against its benchmark, and lists first the categories that drift above it. Use it for "am I spending more than usual?", "which categories went over?", or what a category's benchmark is worth in a month.

Each category: what its expenses cost in the month, each at its net cost (payments less refunds; a split line counts its share in each category; transfers are no spending), a top-level category with its children's; then its benchmark: the monthly average of the six months before (automatic), an amount the user set (set), or none. An automatic benchmark counts only the full months from the user's first entry on, so a new user's is the average of fewer months; there is none yet for a category with nothing spent, net, in those months. A category drifts when it cost more than its benchmark, by any amount; one without a benchmark never drifts. Amounts are in the user's currency; spending on accounts of another currency is shown apart, never converted nor compared. Archived categories show only when they had spending that month. To change a benchmark, use categories edit.

summary, review and days are not available yet: they come with the rest of the review, and answer so, with no figure. Until then, read balances with accounts and lines with lines.

Read only. Examples: {"action":"benchmarks"} · {"action":"benchmarks","month":"2026-10"}`;

/** What the review's other actions answer until the review reads the user's own lines (#32). */
export const NOT_YET = `The rest of the monthly review is not available yet: it comes in a later version of Gousset, and no figure of a month is invented meanwhile. Each category's spending against its benchmark is: call month {"action":"benchmarks"}. The user's own accounts and lines are available too: call accounts {"action":"list"} for the balances, or lines {"action":"search","account":"Current account"} for the lines (name one of the user's accounts as accounts lists it).`;

function benchmarkText(row: CategoryInMonth): string {
  switch (row.benchmark.mode) {
    case "automatic": {
      return row.benchmark.amount === null
        ? "benchmark: none yet (automatic, nothing spent in it in those months)"
        : `benchmark ${amount(row.benchmark.amount)} (automatic)`;
    }

    case "fixed": {
      return `benchmark ${amount(row.benchmark.amount)} (set)`;
    }

    case "none": {
      return "no benchmark";
    }
  }
}

/** How far above its benchmark a drifting row is. */
function aboveText(row: CategoryInMonth): string {
  const mark = row.benchmark.mode === "none" ? null : row.benchmark.amount;

  return mark === null
    ? ""
    : `${amount({ minor: row.spent.minor - mark.minor, currency: mark.currency })} above`;
}

function rowText(row: CategoryInMonth, indent: string): string {
  const archived = row.archived ? " (archived)" : "";

  const elsewhere =
    row.elsewhere.length === 0
      ? ""
      : `, and ${row.elsewhere.map(amount).join(" + ")} in another currency, not compared`;

  const drifts = row.drifts ? `; DRIFTS, ${aboveText(row)}` : "";

  return `${indent}- ${row.name}${archived}: spent ${amount(row.spent)}${elsewhere}; ${benchmarkText(row)}${drifts}`;
}

const pathOf = (row: CategoryInMonth, all: ReadonlyArray<CategoryInMonth>) => {
  const parent = all.find((each) => each.id === row.parentId);

  return parent === undefined ? row.name : `${parent.name} > ${row.name}`;
};

function benchmarksText(result: MonthBenchmarks): string {
  const averaged =
    result.monthsAveraged === 0
      ? `no automatic benchmark can be read yet: no full month from ${result.averageFrom} to ${result.averageTo} holds the user's data`
      : `automatic benchmarks average ${result.monthsAveraged} month(s) of ${result.averageFrom} to ${result.averageTo}, from the user's first entry on`;

  const drifting =
    result.drifting.length === 0
      ? "Nothing drifts above its benchmark."
      : `Drifting above their benchmark: ${result.drifting.map((row) => `${pathOf(row, result.categories)} (${amount(row.spent)}, ${aboveText(row)})`).join(", ")}.`;

  const rows = result.categories.flatMap((top) => [
    rowText(top, ""),
    ...top.children.map((child) => rowText(child, "  ")),
  ]);

  return [
    `Benchmarks of ${result.month}, in ${result.currency}: ${averaged}. A category drifts when it spent more than its benchmark; a top-level category counts its children's spending.`,
    drifting,
    rows.length === 0
      ? "The user has no expense category."
      : `Expense categories (children indented):\n${rows.join("\n")}`,
  ].join("\n\n");
}

const benchmarks = (input: MonthInput, owner: string, currency: string) =>
  Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    return benchmarksText(yield* monthBenchmarks(owner, month, currency));
  }).pipe(Effect.catchTag("QueryFailed", Effect.die));

/** The month family (docs/mcp.md, "Tools"): benchmarks now, the rest of the review with #32. */
export const monthTool = defineTool<MonthInput, typeof MonthInput.Encoded, CategoryStore>({
  name: "month",
  title: "Monthly review",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "benchmarks", month: "2026-10" },
  access: { benchmarks: "read", summary: "read", review: "read", days: "read" },
  run: (input, caller) => {
    switch (input.action) {
      case "benchmarks": {
        return benchmarks(input, caller.userId, benchmarkCurrency(caller));
      }

      case "summary":
      case "review":
      case "days": {
        return Effect.succeed(NOT_YET);
      }
    }
  },
});
