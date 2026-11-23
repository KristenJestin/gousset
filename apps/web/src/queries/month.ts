import type { SpendingGroup } from "@gousset/core/values";
import { queryOptions } from "@tanstack/react-query";

import {
  getCurrentMonth,
  getFlags,
  getImportState,
  getInvestments,
  getLinesToReview,
  getMonthSummary,
  getMovements,
  getSpending,
  getSpendingDays,
} from "@/functions/month";

import { monthKeys } from "./month-keys";

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
  spendingDays: (month: string, by: SpendingGroup, name: string) =>
    queryOptions({
      queryKey: monthKeys.spendingDays(month, by, name),
      queryFn: () => getSpendingDays({ data: { month, by, name } }),
    }),
  movements: (month: string) =>
    queryOptions({
      queryKey: monthKeys.movements(month),
      queryFn: () => getMovements({ data: { month } }),
    }),
  investments: (month: string) =>
    queryOptions({
      queryKey: monthKeys.investments(month),
      queryFn: () => getInvestments({ data: { month } }),
    }),
  imports: (month: string) =>
    queryOptions({
      queryKey: monthKeys.imports(month),
      queryFn: () => getImportState({ data: { month } }),
    }),
  flags: (month: string) =>
    queryOptions({
      queryKey: monthKeys.flags(month),
      queryFn: () => getFlags({ data: { month } }),
    }),
  toReview: (month: string) =>
    queryOptions({
      queryKey: monthKeys.toReview(month),
      queryFn: () => getLinesToReview({ data: { month } }),
    }),
};
