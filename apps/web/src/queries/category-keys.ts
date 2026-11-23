/**
 * The categories domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `categoryKeys.all`. Kept apart from the queries, which call
 * the server, so that what only needs the keys can be tested alone.
 */
export const categoryKeys = {
  all: ["categories"] as const,
  list: () => [...categoryKeys.all, "list"] as const,
};
