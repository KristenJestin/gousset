import type { SpendingGroup } from "@gousset/core/values";
import { queryOptions } from "@tanstack/react-query";

import { getCurrentMonth, getLinesToReview, getMonthSummary, getSpending } from "@/functions/month";

/**
 * The month domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key of a month starts with `monthKeys.of(month)`, so that one call reaches
 * all of a month's queries, and `monthKeys.all` every month's.
 */
export const monthKeys = {
  all: ["month"] as const,
  current: () => [...monthKeys.all, "current"] as const,
  of: (month: string) => [...monthKeys.all, month] as const,
  summary: (month: string) => [...monthKeys.of(month), "summary"] as const,
  spending: (month: string, by: SpendingGroup) => [...monthKeys.of(month), "spending", by] as const,
  toReview: (month: string) => [...monthKeys.of(month), "to-review"] as const,
};

/** The query of each block of a month, for loaders (`ensureQueryData`) and components alike. */
export const monthQueries = {
  /** Today's month on the server; it changes once a month, so it stays fresh for an hour. */
  current: () =>
    queryOptions({
      queryKey: monthKeys.current(),
      queryFn: () => getCurrentMonth(),
      staleTime: 60 * 60_000,
    }),
  summary: (month: string) =>
    queryOptions({
      queryKey: monthKeys.summary(month),
      queryFn: () => getMonthSummary({ data: { month } }),
    }),
  spending: (month: string, by: SpendingGroup) =>
    queryOptions({
      queryKey: monthKeys.spending(month, by),
      queryFn: () => getSpending({ data: { month, by } }),
    }),
  toReview: (month: string) =>
    queryOptions({
      queryKey: monthKeys.toReview(month),
      queryFn: () => getLinesToReview({ data: { month } }),
    }),
};
