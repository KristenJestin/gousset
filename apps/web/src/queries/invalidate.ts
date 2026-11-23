import { addMonths } from "@gousset/core/values";
import type { QueryClient } from "@tanstack/react-query";

import type { Touched } from "@/jobs/view";

import { monthKeys } from "./month-keys";

/**
 * Invalidates the queries of what a job or an action touched (docs/architecture.md): the
 * interface refetches what is on screen and drops the rest. A job's end carries it (`useJob`).
 */
export async function invalidateTouched(queryClient: QueryClient, touched: Touched): Promise<void> {
  if ("everyMonth" in touched) {
    await queryClient.invalidateQueries({ queryKey: monthKeys.all });

    return;
  }

  await Promise.all(
    touched.months.map((month) => queryClient.invalidateQueries({ queryKey: monthKeys.of(month) })),
  );
}

/**
 * Invalidates what approving a line of `month` changes: the month, and the next month's
 * day-by-day spending, whose previous curve counts this month's approved expenses only.
 */
export async function invalidateApproval(queryClient: QueryClient, month: string): Promise<void> {
  await Promise.all([
    invalidateTouched(queryClient, { months: [month] }),
    queryClient.invalidateQueries({
      queryKey: monthKeys.everySpendingDays(addMonths(month, 1)),
    }),
  ]);
}
