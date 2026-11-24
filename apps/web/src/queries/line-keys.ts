import type { LineSearchInput } from "@/functions/lines";

/** A search of the lines without its paging: what one list of the operations page shows. */
export type LineFilters = Omit<LineSearchInput, "after" | "limit">;

/**
 * The lines domain's query keys, from one factory (docs/architecture.md, "Data loading and
 * skeletons"). Every key starts with `lineKeys.all`, so that one call reaches every search and
 * every line's detail. Kept apart from the queries, which call the server, so that what only needs
 * the keys can be tested alone.
 */
export const lineKeys = {
  all: ["lines"] as const,
  searches: () => [...lineKeys.all, "search"] as const,
  search: (filters: LineFilters) => [...lineKeys.searches(), filters] as const,
  details: () => [...lineKeys.all, "detail"] as const,
  detail: (lineId: string) => [...lineKeys.details(), lineId] as const,
  /**
   * Who a line paid and through which intermediary (#30): under `all`, so that whatever reads the
   * lines again (a category, a merchant, a rule, an import) reads it again too.
   */
  merchant: (lineId: string) => [...lineKeys.all, "merchant", lineId] as const,
  /** The lines a line may be linked to, as its dialog searches them (#27). */
  linkCandidates: (lineId: string, text: string) =>
    [...lineKeys.all, "link-candidates", lineId, text] as const,
};
