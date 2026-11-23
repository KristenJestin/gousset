import type { AccountView } from "@gousset/core";

/**
 * The accounts domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `accountKeys.all`, so that one call reaches the list and every
 * account's page; `accountKeys.of(id)` reaches all of one account's. Kept apart from the queries,
 * which call the server, so that what only needs the keys can be tested alone.
 */
export const accountKeys = {
  all: ["accounts"] as const,
  list: () => [...accountKeys.all, "list"] as const,
  of: (accountId: string) => [...accountKeys.all, accountId] as const,
  detail: (accountId: string, view: AccountView = {}) =>
    [...accountKeys.of(accountId), "detail", view] as const,
};
