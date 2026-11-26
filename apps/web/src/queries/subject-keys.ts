/**
 * The subjects domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `subjectKeys.all`: a change of one subject (or of what it
 * counts) reads the list, every page and every preview again. Kept apart from the queries, which
 * call the server, so that what only needs the keys can be tested alone.
 */
export const subjectKeys = {
  all: ["subjects"] as const,
  list: () => [...subjectKeys.all, "list"] as const,
  /** A subject's page, for a year or all time. */
  detail: (subjectId: string, period: number | "all") =>
    [...subjectKeys.all, "detail", subjectId, period] as const,
  /** What the past expenses of some merchants come to, by their ids in order. */
  preview: (merchantIds: ReadonlyArray<string>) =>
    [...subjectKeys.all, "preview", ...merchantIds] as const,
};
