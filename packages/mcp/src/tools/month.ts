import { MIN_CHARGES, Month, currentMonth, monthSubscriptions } from "@gousset/core";
import type { MonthSubscriptionsRead, Subscriptions } from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount } from "./accounts";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["subscriptions", "summary", "review", "days"]).annotate({
    description:
      "subscriptions: the month's recurring payments, those that stopped and the prices that rose. summary, review or days: the review's actions to come, each answering that it is not available yet.",
  }),
  month: Schema.optional(
    Month.annotate({
      description: "subscriptions: the month, YYYY-MM; the current month if left out.",
    }),
  ),
});

type MonthInput = typeof MonthInput.Type;

type Encoded = typeof MonthInput.Encoded;

const DESCRIPTION = `The monthly review. One action answers now, \`subscriptions\`; the others (summary, review, days) are not available yet: they come in a later version of Gousset, each answers so, with no figure, and no figure of a month is ever invented meanwhile.

\`subscriptions\`, with \`month\` (YYYY-MM, the current one if left out; a month to come is refused): the payments that recur (merchant, weekly, monthly or yearly, usual price, last paid day and amount, next expected day), those that stopped (the expected day that did not come) and the prices that rose (from, to). Detected on read from the user's own expenses of the three years up to the month's end (today, in the current month): one merchant paid at a steady rhythm and price, at least ${MIN_CHARGES.weekly} times weekly, ${MIN_CHARGES.monthly} monthly or ${MIN_CHARGES.yearly} yearly; a bill that varies is none. A merchant the user says is no subscription is never proposed: merchants edit with subscription false; true proposes it again.

For the user's own money otherwise, use the other tools: accounts (the balances, account by account, and one account's last lines) and lines (every line, searched by text, account, period or amount). Use them for "how much do I have?" or "what did I pay at the bakery last month?": a month's total is the lines of that period, read with lines.

Read only. Examples: {"action":"subscriptions"} · {"action":"subscriptions","month":"2026-10"}`;

/** What summary, review and days answer until the review reads the user's own lines (v0.4, #126). */
export const NOT_YET = `The monthly review is not available yet: it comes in a later version of Gousset, and no figure of a month is invented meanwhile. The user's own accounts and lines are available now: call accounts {"action":"list"} for the balances, or lines {"action":"search","account":"Current account"} for the lines (name one of the user's accounts as accounts lists it). The month's subscriptions are: month {"action":"subscriptions"}.`;

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

/** The month family (docs/mcp.md, "Tools"): the subscriptions now; the rest of the review to come. */
export const monthTool = defineTool<MonthInput, Encoded, Subscriptions>({
  name: "month",
  title: "Monthly review (subscriptions; the rest not available yet)",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "subscriptions" },
  access: { subscriptions: "read", summary: "read", review: "read", days: "read" },
  run: (input, caller) => {
    switch (input.action) {
      case "subscriptions": {
        return subscriptions(caller.userId, input);
      }

      case "summary":
      case "review":
      case "days": {
        return Effect.succeed(NOT_YET);
      }
    }
  },
});
