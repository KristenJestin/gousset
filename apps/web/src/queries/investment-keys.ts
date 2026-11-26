/**
 * The investments domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"): the investment accounts with their cash and positions, and a page of one account's
 * operations (`after` the operation the page before ended on, null for the first). Every key starts
 * with `investmentKeys.all`, so that one call reaches them all.
 */
export const investmentKeys = {
  all: ["investments"] as const,
  list: () => [...investmentKeys.all, "list"] as const,
  operations: (accountId: string, after: string | null) =>
    [...investmentKeys.all, accountId, "operations", after] as const,
};
