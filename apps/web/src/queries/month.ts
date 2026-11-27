import type { DaysBy } from "@gousset/core";
import { queryOptions } from "@tanstack/react-query";

import { getMonthReview, getSpendingDays } from "@/functions/review";

import { monthKeys } from "./month-keys";

/** A month's queries, for the review's loader (`ensureQueryData`) and its blocks alike. */
export const monthQueries = {
  /** Every block of the month at once, and its calendar: the review's first paint. */
  review: (month: string) =>
    queryOptions({
      queryKey: monthKeys.review(month),
      queryFn: () => getMonthReview({ data: { month } }),
    }),
  /** A row's spending day by day, read when its detail opens: a subject's too (#37). */
  spendingDays: (month: string, by: DaysBy, id: string | null) =>
    queryOptions({
      queryKey: monthKeys.spendingDays(month, by, id),
      queryFn: () => getSpendingDays({ data: { month, by, id } }),
    }),
};
