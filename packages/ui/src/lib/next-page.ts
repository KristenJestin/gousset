// When a paged list asks for its next page. ui-sdk's virtualiser has an `onEnd` of its own, but it
// asks once per row count, for good: a new search whose first page has as many rows as the last
// one's never asks for its second page. The list asks by these rules instead.

/** How near the last loaded row the list asks for the next page, in rows. */
export const END_ROWS = 10;

/**
 * What a list's rows are known by, to ask for the next page once per set of rows: their count, how
 * many match in all, and their first and last ids. A page appended changes it (the count, the last
 * id), and so does a new search, even one with as many rows (the first id, the total).
 */
export function rowsMark(rows: ReadonlyArray<{ id: string }>, total: number): string {
  return JSON.stringify([rows.length, total, rows[0]?.id ?? null, rows.at(-1)?.id ?? null]);
}

/**
 * Whether the list asks for the next page now: the last row in its window (`lastShown`, an index)
 * is among the last `END_ROWS` of the `count` loaded, and it has not asked yet for these rows
 * (`askedFor`, the `rowsMark` of the rows it last asked for).
 */
export function asksNextPage(
  lastShown: number,
  count: number,
  mark: string,
  askedFor: string | null,
): boolean {
  return count > 0 && lastShown >= count - 1 - END_ROWS && mark !== askedFor;
}
