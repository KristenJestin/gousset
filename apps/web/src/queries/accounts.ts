import type { AccountView } from "@gousset/core";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getAccount, getAccounts } from "@/functions/accounts";

import { accountKeys } from "./account-keys";
import { lineKeys } from "./line-keys";
import { reviewKeys } from "./review-keys";

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
 * operations name each line's account, so theirs are too, and the review counts the accounts.
 */
export async function invalidateAccounts(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: accountKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: reviewKeys.all }),
  ]);
}
