/**
 * The rules domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `ruleKeys.all`: a change of one rule (or a job applying it)
 * reads the list, its detail and every reach again. Kept apart from the queries, which call the
 * server, so that what only needs the keys can be tested alone.
 */
export const ruleKeys = {
  all: ["rules"] as const,
  list: () => [...ruleKeys.all, "list"] as const,
  detail: (ruleId: string) => [...ruleKeys.all, "detail", ruleId] as const,
  /** What a draft would do to the lines already there, by the draft as JSON. */
  reach: (draft: string) => [...ruleKeys.all, "reach", draft] as const,
  /**
   * The rule a correction proposes, for a line and the category it was put in, or the merchant it
   * was given (#30).
   */
  proposal: (lineId: string, categoryId: string | null, merchantId: string | null) =>
    [...ruleKeys.all, "proposal", lineId, categoryId, merchantId] as const,
};
