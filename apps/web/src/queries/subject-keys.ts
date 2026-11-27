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
  /** What the past expenses of some merchants come to, for a subject (null: a new one), by ids. */
  preview: (merchantIds: ReadonlyArray<string>, subjectId: string | null) =>
    [...subjectKeys.all, "preview", subjectId, ...merchantIds] as const,
  /** What the user still waits for, of the paid-back subjects (#217). */
  waiting: () => [...subjectKeys.all, "waiting"] as const,
  /** Every receipt of a subject's lines (#217). */
  receipts: (subjectId: string) => [...subjectKeys.all, "receipts", subjectId] as const,
};
