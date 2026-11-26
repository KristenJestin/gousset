import type { DaysBy } from "@gousset/core";

/**
 * The month domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key of a month starts with `monthKeys.of(month)`, so that one call reaches
 * all of a month's queries, and `monthKeys.all` every month's: what a job touched is read again
 * by them (`invalidateTouched`). Kept apart from the queries, which call the server, so that what
 * only needs the keys can be tested alone.
 */
export const monthKeys = {
  all: ["month"] as const,
  of: (month: string) => [...monthKeys.all, month] as const,
  /** Every block of the month's review, and its recurring payments' calendar. */
  review: (month: string) => [...monthKeys.of(month), "review"] as const,
  /** A row's spending day by day; `id` null for the merchants' row of none. A subject's too. */
  spendingDays: (month: string, by: DaysBy, id: string | null) =>
    [...monthKeys.of(month), "spending-days", by, id] as const,
};
