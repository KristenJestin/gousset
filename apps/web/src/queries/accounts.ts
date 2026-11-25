import type { AccountView } from "@gousset/core";
import { queryOptions } from "@tanstack/react-query";

import { getAccount, getAccounts } from "@/functions/accounts";

import { accountKeys } from "./account-keys";

// Kept in `invalidate`, which loads no server function, so that it can be tested alone.
export { invalidateAccounts } from "./invalidate";

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
