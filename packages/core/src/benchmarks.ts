import { Effect } from "effect";

import { CategoryStore } from "./category-store";
import { currentMonth } from "./today";
import type { CategoryRecord, MonthlySpending } from "./category-store";
import type { Money } from "./month";
import { addMonths } from "./values";

// Each expense category's benchmark in a month, and what drifts above it (#33; docs/data-model.md,
// "v0.4: Monthly review"). Computed on read from the expenses, for the review and the MCP door
// alike: nothing is stored.

/** The months an automatic benchmark averages: the six before the month read. */
export const BENCHMARK_WINDOW = 6;

/** A category's benchmark in a month, as the review draws it on its row. */
export type MonthBenchmark =
  /**
   * The average of the months before; null when there is nothing to average: the user's data
   * starts after them, or the category had no expense in them.
   */
  | { readonly mode: "automatic"; readonly amount: Money | null }
  /** The amount the user set, in their currency. */
  | { readonly mode: "fixed"; readonly amount: Money }
  | { readonly mode: "none" };

/** An expense category in a month: what it cost, against its benchmark. */
export type CategoryInMonth = {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  /** Null for a top-level category. */
  readonly parentId: string | null;
  /** Archived: shown only for what it cost this month. */
  readonly archived: boolean;
  /**
   * What its expenses cost in the month, each at its net cost, in the user's currency; a top-level
   * category's with its children's.
   */
  readonly spent: Money;
  /** What it cost in other currencies: never converted, never held against the benchmark. */
  readonly elsewhere: ReadonlyArray<Money>;
  readonly benchmark: MonthBenchmark;
  /** Spent above its benchmark, by any amount. */
  readonly drifts: boolean;
  /** Its children in order; empty for a child. */
  readonly children: ReadonlyArray<CategoryInMonth>;
};

/** Every expense category's benchmark in a month, and what drifts. */
export type MonthBenchmarks = {
  /** `YYYY-MM`. */
  readonly month: string;
  /** The user's currency: the one spending is held against benchmarks in. */
  readonly currency: string;
  /**
   * The months automatic benchmarks average, `YYYY-MM`: the six before `month`, up to the last
   * full month before today's (`averageTo` may then come before `averageFrom`: none).
   */
  readonly averageFrom: string;
  readonly averageTo: string;
  /**
   * How many of them count: those from the month of the user's first entry on. Fewer than six for
   * a new user, 0 with none, and then no automatic benchmark.
   */
  readonly monthsAveraged: number;
  /** The expense categories as a tree, siblings in order; archived ones only with spending. */
  readonly categories: ReadonlyArray<CategoryInMonth>;
  /** Those that drift, parents before their children, in the tree's order. */
  readonly drifting: ReadonlyArray<CategoryInMonth>;
};

/** Siblings in order: position, then id. */
const inOrder = (a: CategoryRecord, b: CategoryRecord) =>
  a.position - b.position || a.id.localeCompare(b.id);

/** A month `YYYY-MM` as a count of months, to subtract one from another. */
function monthIndex(month: string): number {
  const [year = 0, number = 1] = month.split("-").map(Number);

  return year * 12 + number;
}

/**
 * How many months of `from` to `to` (`YYYY-MM`, both included) an average counts: those from the
 * month of the user's first entry (`firstDay`) on, when their data starts; 0 with none. A month
 * with nothing in a category counts as 0 for it, a month before the user's data not at all.
 */
export function monthsCounted(firstDay: string | null, from: string, to: string): number {
  if (firstDay === null) {
    return 0;
  }

  const first = firstDay.slice(0, 7);
  const start = first > from ? first : from;

  return Math.max(0, monthIndex(to) - monthIndex(start) + 1);
}

/** The last day of a month `YYYY-MM`. */
function lastDayOf(month: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);

  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/** In use, or archived with something spent in the month. */
const shown = (row: CategoryInMonth) =>
  !row.archived || row.spent.minor !== 0 || row.elsewhere.length > 0;

/** Sums per currency, the user's apart from the others. */
function totals(rows: ReadonlyArray<MonthlySpending>, currency: string) {
  let own = 0;
  const others = new Map<string, number>();

  for (const row of rows) {
    if (row.currency === currency) {
      own += row.minor;
    } else {
      others.set(row.currency, (others.get(row.currency) ?? 0) + row.minor);
    }
  }

  const elsewhere = [...others]
    .filter(([, minor]) => minor !== 0)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([other, minor]): Money => ({ currency: other, minor }));

  return { own, elsewhere };
}

/**
 * Every expense category's spending in `month` (`YYYY-MM`) against its benchmark, in the user's
 * `currency`. An automatic benchmark is the monthly average of the six months before, counting
 * only the months from the user's first entry on and before today's month (a month with nothing
 * spent in the category counts as 0; none when it spent nothing, net, in them); a fixed one is
 * the user's amount; none is none. A category drifts when it cost more than its benchmark, by
 * any amount. A top-level category counts its children's expenses with its
 * own, against its own benchmark; each child against its own.
 */
export const monthBenchmarks = (owner: string, month: string, currency: string) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    const averageFrom = addMonths(month, -BENCHMARK_WINDOW);
    const lastFull = addMonths(yield* currentMonth, -1);
    const previous = addMonths(month, -1);
    // A month to come, or the one under way, is no month to average.
    const averageTo = previous < lastFull ? previous : lastFull;
    const categories = yield* store.list(owner);

    const history = yield* store.spending(owner, {
      from: `${averageFrom}-01`,
      to: lastDayOf(month),
    });

    const monthsAveraged = monthsCounted(yield* store.firstEntry(owner), averageFrom, averageTo);

    const expenses = categories.filter((each) => each.kind === "expense");
    const childrenOf = (id: string) => expenses.filter((each) => each.parentId === id);

    /** The rows of a category's own expenses, and its children's for a top-level one. */
    const rowsOf = (category: CategoryRecord) => {
      const ids = new Set([category.id, ...childrenOf(category.id).map((child) => child.id)]);

      return history.filter((row) => ids.has(row.categoryId));
    };

    const benchmarkOf = (
      category: CategoryRecord,
      before: ReadonlyArray<MonthlySpending>,
    ): MonthBenchmark => {
      switch (category.benchmark.mode) {
        case "automatic": {
          const net = before
            .filter((row) => row.currency === currency)
            .reduce((sum, row) => sum + row.minor, 0);

          // Nothing spent, net (no expense, or all refunded): nothing to average.
          return {
            mode: "automatic",
            amount:
              monthsAveraged === 0 || net <= 0
                ? null
                : { minor: Math.round(net / monthsAveraged), currency },
          };
        }

        case "fixed": {
          return { mode: "fixed", amount: { minor: category.benchmark.minor, currency } };
        }

        case "none": {
          return { mode: "none" };
        }
      }
    };

    const rowOf = (
      category: CategoryRecord,
      children: ReadonlyArray<CategoryInMonth>,
    ): CategoryInMonth => {
      const rows = rowsOf(category);

      const now = totals(
        rows.filter((row) => row.month === month),
        currency,
      );

      const benchmark = benchmarkOf(
        category,
        rows.filter((row) => row.month >= averageFrom && row.month <= averageTo),
      );

      const mark = benchmark.mode === "none" ? null : benchmark.amount;

      return {
        id: category.id,
        name: category.name,
        icon: category.icon,
        parentId: category.parentId,
        archived: category.archivedAt !== null,
        spent: { minor: now.own, currency },
        elsewhere: now.elsewhere,
        benchmark,
        drifts: mark !== null && now.own > mark.minor,
        children,
      };
    };

    const tree = expenses
      .filter((each) => each.parentId === null)
      .toSorted(inOrder)
      .flatMap((top) => {
        const children = childrenOf(top.id)
          .toSorted(inOrder)
          .map((child) => rowOf(child, []))
          .filter(shown);

        const row = rowOf(top, children);

        return shown(row) || children.length > 0 ? [row] : [];
      });

    const drifting = tree.flatMap((top) => [top, ...top.children]).filter((row) => row.drifts);

    const benchmarks: MonthBenchmarks = {
      month,
      currency,
      averageFrom,
      averageTo,
      monthsAveraged,
      categories: tree,
      drifting,
    };

    return benchmarks;
  });
