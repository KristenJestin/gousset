import { Month, currentMonth, monthOverview } from "@gousset/core";
import type { Ledger, Money, MonthOverview, Spending } from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";

const MonthInput = Schema.Struct({
  action: Schema.Literal("summary").annotate({
    description: "summary: the month's figures and where its money went.",
  }),
  month: Schema.optional(
    Month.annotate({ description: "The month, YYYY-MM (2026-10); the current month if left out." }),
  ),
});

const DESCRIPTION = `The summary of one month of the user's money: what came in (received), what the expenses cost (spent), what went to savings and investments (set aside) and what is left; then where the money went, by category and by merchant, the largest first. Use it for "how much did I spend last month, and where?" and any question about a month's totals.

It only reads. \`month\` is written YYYY-MM and is the current month when left out; for last month, work it out from today (in November 2026, last month is 2026-10). A month written another way is refused.

In this version of Gousset every figure comes from made-up example data, and the result says so.

Example: {"action":"summary","month":"2026-10"}`;

/** `1,234.56 EUR`: amounts are kept in minor units and shown with their currency. */
function amount(money: Money): string {
  const units = (money.minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${units} ${money.currency}`;
}

/** `October 2026` (a month is read within ten years of today: never a year under 100). */
function monthName(month: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);

  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function breakdown(title: string, spending: Spending): string {
  if (spending.rows.length === 0) {
    return `${title} nothing spent.`;
  }

  return [title, ...spending.rows.map((row) => `- ${row.name}: ${amount(row.amount)}`)].join("\n");
}

/** The overview, in Gousset's words: the figures first, then where the money went. */
function summaryText({ summary, byCategory, byMerchant }: MonthOverview): string {
  const heading = summary.madeUp
    ? `${monthName(summary.month)}, made-up data: this version of Gousset shows example figures, not the user's own.`
    : monthName(summary.month);

  return [
    heading,
    [
      `Received: ${amount(summary.received)}`,
      `Spent: ${amount(summary.spent)}`,
      `Set aside: ${amount(summary.setAside)}`,
      `Left: ${amount(summary.left)}`,
    ].join("\n"),
    breakdown("By category:", byCategory),
    breakdown("By merchant:", byMerchant),
  ].join("\n\n");
}

/** The month family (docs/mcp.md, "Tools"): v0.1 reads the made-up month. */
export const monthTool = defineTool<typeof MonthInput.Type, typeof MonthInput.Encoded, Ledger>({
  name: "month",
  title: "Month summary",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "summary", month: "2026-10" },
  access: { summary: "read" },
  run: (input, caller) => {
    switch (input.action) {
      case "summary": {
        return Effect.gen(function* () {
          const wanted = input.month ?? (yield* currentMonth);

          return summaryText(yield* monthOverview(caller.userId, wanted));
        }).pipe(
          Effect.catchTag("MonthOutOfRange", (outside) =>
            Effect.fail(
              new ToolRefusal({
                message: `Gousset reads months from ${outside.earliest} to ${outside.latest}: ${outside.month} is outside. Ask for a month in that range.`,
                example: `month ${JSON.stringify({ action: "summary", month: "2026-10" })}`,
              }),
            ),
          ),
        );
      }
    }
  },
});
