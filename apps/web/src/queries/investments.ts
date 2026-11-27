import { queryOptions } from "@tanstack/react-query";

import { getInvestmentOperations, getInvestments } from "@/functions/investments";

import { investmentKeys } from "./investment-keys";

/** The investments page's queries, for its loader and its blocks alike. */
export const investmentQueries = {
  /** The investment accounts, each with its cash and its open positions, and today. */
  list: () =>
    queryOptions({
      queryKey: investmentKeys.list(),
      queryFn: () => getInvestments(),
    }),
  /**
   * A page of one account's operations, newest first; `after` the operation the page before ended
   * on. An account the user does not have comes back as `{ ok: false, code }`.
   */
  operations: (accountId: string, after: string | null = null) =>
    queryOptions({
      queryKey: investmentKeys.operations(accountId, after),
      queryFn: () => getInvestmentOperations({ data: { accountId, after } }),
    }),
};
