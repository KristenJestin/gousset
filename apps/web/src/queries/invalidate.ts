import type { QueryClient } from "@tanstack/react-query";

import { monthKeys } from "./month";

/**
 * What a background job or an action changed: some months, or every month (a rule applied to the
 * past). The job's end says it; the interface refetches what is on screen and drops the rest.
 */
export type Touched = { months: ReadonlyArray<string> } | { everyMonth: true };

/** Invalidates the queries of what a job or an action touched (docs/architecture.md). */
export async function invalidateTouched(queryClient: QueryClient, touched: Touched): Promise<void> {
  if ("everyMonth" in touched) {
    await queryClient.invalidateQueries({ queryKey: monthKeys.all });

    return;
  }

  await Promise.all(
    touched.months.map((month) => queryClient.invalidateQueries({ queryKey: monthKeys.of(month) })),
  );
}
