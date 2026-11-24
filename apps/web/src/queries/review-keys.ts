/**
 * The review domain's query keys (docs/architecture.md, "Data loading and skeletons"). Kept apart
 * from the queries, which call the server, so that what only needs the keys can be tested alone.
 */
export const reviewKeys = {
  all: ["review"] as const,
  /** Counts of the accounts, the imports and the lines: whatever touches those changes them. */
  startingPoints: () => [...reviewKeys.all, "starting-points"] as const,
  /**
   * A line to review and its proposal (#35): under `all`, so that whatever touches the lines (an
   * accept, a correction, a pairing, an import) reads it again.
   */
  line: (lineId: string) => [...reviewKeys.all, "line", lineId] as const,
};
