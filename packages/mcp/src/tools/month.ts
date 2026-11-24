import {
  MIN_CHARGES,
  Month,
  currentMonth,
  monthBenchmarks,
  monthSubscriptions,
} from "@gousset/core";
import type {
  CategoryInMonth,
  CategoryStore,
  MonthBenchmarks,
  MonthSubscriptionsRead,
  Subscriptions,
} from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount } from "./accounts";
import { benchmarkCurrency } from "./categories";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["subscriptions", "benchmarks", "summary", "review", "days"]).annotate({
    description:
      "subscriptions: the month's recurring payments, those that stopped and the prices that rose. benchmarks: each expense category's spending in the month against its benchmark, and what drifts above it. summary, review or days: the review's actions to come, each answering that it is not available yet.",
  }),
  month: Schema.optional(
    Month.annotate({
      description: "subscriptions, benchmarks: the month, YYYY-MM; the current month if left out.",
    }),
  ),
});

type MonthInput = typeof MonthInput.Type;

type Encoded = typeof MonthInput.Encoded;

const DESCRIPTION = `The monthly review. Two actions answer now, \`subscriptions\` and \`benchmarks\`; the others (summary, review, days) are not available yet: they come in a later version of Gousset, each answers so, with no figure, and no figure of a month is ever invented meanwhile.

\`subscriptions\`, with \`month\` (YYYY-MM, the current one if left out; a month to come is refused): the payments that recur (merchant, weekly, monthly or yearly, usual price, last paid day and amount, next expected day), those that stopped (the expected day that did not come) and the prices that rose (from, to). Detected on read from the user's own expenses of the three years up to the month's end (today, in the current month): one merchant paid at a steady rhythm and price, at least ${MIN_CHARGES.weekly} times weekly, ${MIN_CHARGES.monthly} monthly or ${MIN_CHARGES.yearly} yearly; a bill that varies is none. A merchant the user says is no subscription is never proposed: merchants edit with subscription false; true proposes it again.

\`benchmarks\`, with \`month\` (the current one if left out): every expense category's spending against its benchmark, the categories that drift above it first. Use it for "am I spending more than usual?" or "which categories went over?". Each category: what its expenses cost in the month, each at its net cost (payments less refunds; a split line counts its share in each category; transfers are no spending), a top-level category with its children's; then its benchmark: the monthly average of the six months before (automatic), an amount the user set (set), or none. An automatic benchmark counts only the full months from the user's first entry on, so a new user's is the average of fewer months; there is none yet for a category with nothing spent, net, in those months. A category drifts when it cost more than its benchmark, by any amount; one without a benchmark never drifts. Amounts are in the user's currency; spending on accounts of another currency is shown apart, never converted nor compared. Archived categories show only when they had spending that month. To change a benchmark, use categories edit.

For the user's own money otherwise, use the other tools: accounts (the balances, account by account, and one account's last lines) and lines (every line, searched by text, account, period or amount). Use them for "how much do I have?" or "what did I pay at the bakery last month?": a month's total is the lines of that period, read with lines.

Read only. Examples: {"action":"subscriptions"} · {"action":"benchmarks","month":"2026-10"}`;

/** What summary, review and days answer until the review reads the user's own lines (#32). */
export const NOT_YET = `The rest of the monthly review is not available yet: it comes in a later version of Gousset, and no figure of a month is invented meanwhile. The user's own accounts and lines are available now: call accounts {"action":"list"} for the balances, or lines {"action":"search","account":"Current account"} for the lines (name one of the user's accounts as accounts lists it). The month's subscriptions are: month {"action":"subscriptions"}. Each category's spending against its benchmark is: month {"action":"benchmarks"}.`;

const CADENCES = { weekly: "weekly", monthly: "monthly", yearly: "yearly" } as const;

const money = (minor: number, currency: string) => amount({ minor, currency });

/** The month's subscriptions as text: names, not ids, and how to dismiss one. */
function subscriptionsText(read: MonthSubscriptionsRead): string {
  const header = `Subscriptions of ${read.month}, detected from the user's expenses up to ${read.asOf}.`;

  const recurring =
    read.recurring.length === 0
      ? ["No recurring payment detected."]
      : [
          `Recurring payments (${read.recurring.length}; merchant: rhythm, usual price; last paid; next expected):`,
          ...read.recurring.map(
            (each) =>
              `- ${each.merchant}: ${CADENCES[each.cadence]}, usually ${money(each.usualMinor, each.currency)}; last paid ${each.lastOn}, ${money(each.lastMinor, each.currency)}; next expected ${each.nextOn}.`,
          ),
        ];

  const stopped =
    read.stopped.length === 0
      ? []
      : [
          `Stopped (${read.stopped.length}; the expected payment did not come):`,
          ...read.stopped.map(
            (each) =>
              `- ${each.merchant}: ${CADENCES[each.cadence]}, expected ${each.stoppedOn ?? each.nextOn}, did not come; last paid ${each.lastOn}, ${money(each.lastMinor, each.currency)}.`,
          ),
        ];

  const rises =
    read.rises.length === 0
      ? []
      : [
          `Price rises (${read.rises.length}):`,
          ...read.rises.flatMap((each) =>
            each.priceRise === null
              ? []
              : [
                  `- ${each.merchant}: from ${money(each.priceRise.fromMinor, each.currency)} to ${money(each.priceRise.toMinor, each.currency)}.`,
                ],
          ),
        ];

  const [first] = [...read.recurring, ...read.stopped];

  const dismiss = `A merchant whose payments are no subscription is never proposed again with merchants ${JSON.stringify({ action: "edit", merchant: first?.merchant ?? "Streamly", subscription: false })}; subscription true proposes it again.`;

  return [header, recurring.join("\n"), stopped.join("\n"), rises.join("\n"), dismiss]
    .filter((part) => part !== "")
    .join("\n\n");
}

function subscriptions(owner: string, input: MonthInput) {
  return Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    return subscriptionsText(yield* monthSubscriptions(owner, month));
  }).pipe(
    Effect.catchTags({
      FutureMonthRefused: (refused) =>
        Effect.fail(
          new ToolRefusal({
            message: `${refused.month} is a month to come: subscriptions are detected from what was paid up to today. Ask for ${refused.current} or a month before it.`,
            example: `month ${JSON.stringify({ action: "subscriptions", month: refused.current } satisfies Encoded)}`,
          }),
        ),
      QueryFailed: Effect.die,
    }),
  );
}

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

/** The month family (docs/mcp.md, "Tools"): subscriptions and benchmarks now; the rest to come. */
export const monthTool = defineTool<MonthInput, Encoded, Subscriptions | CategoryStore>({
  name: "month",
  title: "Monthly review (subscriptions and benchmarks; the rest not available yet)",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "subscriptions" },
  access: {
    subscriptions: "read",
    benchmarks: "read",
    summary: "read",
    review: "read",
    days: "read",
  },
  run: (input, caller) => {
    switch (input.action) {
      case "subscriptions": {
        return subscriptions(caller.userId, input);
      }

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
