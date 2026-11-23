import type { AccountView } from "@gousset/core";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getAccount, getAccounts } from "@/functions/accounts";

import { lineKeys } from "./lines";

/**
 * The accounts domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `accountKeys.all`, so that one call reaches the list and every
 * account's page; `accountKeys.of(id)` reaches all of one account's.
 */
export const accountKeys = {
  all: ["accounts"] as const,
  list: () => [...accountKeys.all, "list"] as const,
  of: (accountId: string) => [...accountKeys.all, accountId] as const,
  detail: (accountId: string, view: AccountView = {}) =>
    [...accountKeys.of(accountId), "detail", view] as const,
};

/** The query of the accounts page and of an account's, for loaders and components alike. */
export const accountQueries = {
  list: () =>
    queryOptions({
      queryKey: accountKeys.list(),
      queryFn: () => getAccounts(),
    }),
  /**
   * An account's page; `view` reads older lines (`before`), more or fewer (`limit`) or other days
   * for the chart (`from`, `to`). A refusal comes back as `{ ok: false, code }`.
   */
  detail: (accountId: string, view: AccountView = {}) =>
    queryOptions({
      queryKey: accountKeys.detail(accountId, view),
      queryFn: () => getAccount({ data: { accountId, ...view } }),
    }),
};

/**
 * After a write to an account (create, edit, close, reopen, a noted balance): the list's groups and
 * totals and the account's page may all have changed, so every accounts query is read again; the
 * operations name each line's account, so theirs are too.
 */
export async function invalidateAccounts(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
  ]);
}
