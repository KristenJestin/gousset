/**
 * The merchants domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `merchantKeys.all`, so that one call reaches every list and
 * every merchant's page: a rename, a merge or a label moved changes both. Kept apart from the
 * queries, which call the server, so that what only needs the keys can be tested alone.
 */
export const merchantKeys = {
  all: ["merchants"] as const,
  lists: () => [...merchantKeys.all, "list"] as const,
  /** The list matching `text` (blank for all), every page of it. */
  list: (text: string) => [...merchantKeys.lists(), text] as const,
  /** The names a name field offers for `text`. */
  names: (text: string) => [...merchantKeys.all, "names", text] as const,
  details: () => [...merchantKeys.all, "detail"] as const,
  detail: (merchantId: string) => [...merchantKeys.details(), merchantId] as const,
};
