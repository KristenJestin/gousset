import type { SpendingGroup } from "@gousset/core/values";

/**
 * The month domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key of a month starts with `monthKeys.of(month)`, so that one call reaches
 * all of a month's queries, and `monthKeys.all` every month's. Kept apart from the queries, which
 * call the server, so that what only needs the keys can be tested alone.
 */
export const monthKeys = {
  all: ["month"] as const,
  current: () => [...monthKeys.all, "current"] as const,
  of: (month: string) => [...monthKeys.all, month] as const,
  summary: (month: string) => [...monthKeys.of(month), "summary"] as const,
  spending: (month: string, by: SpendingGroup) => [...monthKeys.of(month), "spending", by] as const,
  /** Every row's day-by-day spending of the month. */
  everySpendingDays: (month: string) => [...monthKeys.of(month), "spending-days"] as const,
  spendingDays: (month: string, by: SpendingGroup, name: string) =>
    [...monthKeys.everySpendingDays(month), by, name] as const,
  movements: (month: string) => [...monthKeys.of(month), "movements"] as const,
  investments: (month: string) => [...monthKeys.of(month), "investments"] as const,
  imports: (month: string) => [...monthKeys.of(month), "imports"] as const,
  flags: (month: string) => [...monthKeys.of(month), "flags"] as const,
  toReview: (month: string) => [...monthKeys.of(month), "to-review"] as const,
};
