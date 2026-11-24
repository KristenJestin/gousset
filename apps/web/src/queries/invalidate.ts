import type { QueryClient } from "@tanstack/react-query";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { lineKeys } from "./line-keys";
import { monthKeys } from "./month-keys";

/**
 * Invalidates the queries of what a job or an action touched (docs/architecture.md): the
 * interface refetches what is on screen and drops the rest. A job's end carries it (`useJob`).
 * Whatever touched months touched their lines too, which the operations and the accounts show.
 */
export async function invalidateTouched(queryClient: QueryClient, touched: Touched): Promise<void> {
  const linesAndAccounts = [
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
  ];

  if ("everyMonth" in touched) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: monthKeys.all }),
      ...linesAndAccounts,
    ]);

    return;
  }

  await Promise.all([
    ...touched.months.map((month) =>
      queryClient.invalidateQueries({ queryKey: monthKeys.of(month) }),
    ),
    ...linesAndAccounts,
  ]);
}
