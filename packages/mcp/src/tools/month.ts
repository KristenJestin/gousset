import { Effect, Schema } from "effect";

import { defineTool } from "../tool";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["summary", "review", "days"]).annotate({
    description:
      "summary, review or days: the review's actions to come. Each answers that the monthly review is not available yet.",
  }),
});

const DESCRIPTION = `The monthly review, which is not available yet: it comes in a later version of Gousset. Every action (summary, review, days) answers so, with no figure, and no figure of a month is ever invented meanwhile.

For the user's own money today, use the other tools: accounts (the balances, account by account, and one account's last lines) and lines (every line, searched by text, account, period or amount). Use them for "how much do I have?" or "what did I pay at the bakery last month?": a month's total is the lines of that period, read with lines.

Read only. Example: {"action":"summary"}`;

/** What every action answers until the review reads the user's own lines (v0.4, #126). */
export const NOT_YET = `The monthly review is not available yet: it comes in a later version of Gousset, and no figure of a month is invented meanwhile. The user's own accounts and lines are available now: call accounts {"action":"list"} for the balances, or lines {"action":"search","account":"Current account"} for the lines (name one of the user's accounts as accounts lists it).`;

/** The month family (docs/mcp.md, "Tools"): no review yet, so no figure; v0.4 brings it. */
export const monthTool = defineTool<typeof MonthInput.Type, typeof MonthInput.Encoded>({
  name: "month",
  title: "Monthly review (not available yet)",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "summary" },
  access: { summary: "read", review: "read", days: "read" },
  run: () => Effect.succeed(NOT_YET),
});
