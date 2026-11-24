import { Schema } from "effect";

// The values the interface sends and checks, without the logic: the browser may import this file
// (`@gousset/core/values`) without bringing the ledger along.

/** `YYYY-MM`. */
export const Month = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: "A month is written YYYY-MM, as 2026-10.",
  }),
);

/** What spending is grouped by: the tabs of "Where the money goes". */
export const SpendingGroup = Schema.Literals(["category", "merchant", "subject"]);

export type SpendingGroup = typeof SpendingGroup.Type;

/** How many categories one line may be split across (#27). */
export const MAX_SHARES = 20;

/** The month `count` months after `month` (before, when negative), both `YYYY-MM`. */
export function addMonths(month: string, count: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + count, 1));

  return date.toISOString().slice(0, 7);
}
