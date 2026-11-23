import { addMonths } from "@gousset/core/values";
import type { QueryClient } from "@tanstack/react-query";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { categoryKeys } from "./category-keys";
import { lineKeys } from "./line-keys";
import { merchantKeys } from "./merchant-keys";
import { monthKeys } from "./month-keys";

/**
 * Invalidates the queries of what a job or an action touched (docs/architecture.md): the
 * interface refetches what is on screen and drops the rest. A job's end carries it (`useJob`).
 * Whatever touched months touched their lines too, which the operations and the accounts show, and
 * the merchants an import recognises from them (#24).
 */
export async function invalidateTouched(queryClient: QueryClient, touched: Touched): Promise<void> {
  const linesAndAccounts = [
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
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

/**
 * Invalidates what a merchant's merge, a cleaned label moved or a default category set changes:
 * the merchants, and the entries the server moved to a merchant's default category (#23), which
 * the operations, the months' spending and the categories' figures show.
 */
export async function invalidateMerchantEntries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: merchantKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  ]);
}

/**
 * Invalidates what approving a line of `month` changes: the month, its lines, and the next month's
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
