import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getLine, getLines } from "@/functions/lines";

import { lineKeys } from "./line-keys";
import type { LineFilters } from "./line-keys";

/**
 * Lines a page: a few screens of rows at once, so that a long scroll asks the server seldom, and
 * well under the core's most (`MAX_SEARCH_LINES`).
 */
const PAGE_LINES = 200;

/** The queries of the operations page, for its loader and its components alike. */
export const lineQueries = {
  /**
   * The lines that match, a page at a time: each page's `next` is the cursor of the one after it
   * (the first page's cursor is blank, which the core reads as none). While another search loads,
   * the last one's pages stay on screen (`keepPreviousData`), so that the list's rows slide to
   * their new places rather than giving way to a skeleton. A refusal comes back as
   * `{ ok: false, code }`, as a page.
   */
  search: (filters: LineFilters) =>
    infiniteQueryOptions({
      queryKey: lineKeys.search(filters),
      queryFn: ({ pageParam }) =>
        getLines({ data: { ...filters, after: pageParam, limit: PAGE_LINES } }),
      initialPageParam: "",
      getNextPageParam: (last) => (last.ok ? (last.page.next ?? undefined) : undefined),
      placeholderData: keepPreviousData,
    }),
  /** One line's detail; a line the user does not have comes back as `{ ok: false, code }`. */
  detail: (lineId: string) =>
    queryOptions({
      queryKey: lineKeys.detail(lineId),
      queryFn: () => getLine({ data: { lineId } }),
    }),
};
