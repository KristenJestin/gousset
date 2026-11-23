import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getLine, getLines } from "@/functions/lines";

import { lineKeys } from "./line-keys";
import type { LineFilters } from "./line-keys";

/**
 * Lines a page: a few screens of rows at once, so that a long scroll asks the server seldom, and
 * well under the core's most (`MAX_SEARCH_LINES`).
 */
const PAGE_LINES = 200;

/** The lines the link dialog offers at once: a short list, the search narrowing it. */
const LINK_CANDIDATES = 20;

/** How many days around a line its link dialog looks, unless searched: an expense's season. */
const LINK_DAYS = 60;

const DAY_MS = 86_400_000;

const dayShifted = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

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
  /**
   * The lines a line may be linked to (#27): those whose text holds `text`, booked within
   * `LINK_DAYS` of the line, nearest first in the list's order; the line itself left out.
   */
  linkCandidates: (lineId: string, bookedOn: string, text: string) =>
    queryOptions({
      queryKey: lineKeys.linkCandidates(lineId, text),
      queryFn: async () => {
        const found = await getLines({
          data: {
            text,
            from: dayShifted(bookedOn, -LINK_DAYS),
            to: dayShifted(bookedOn, LINK_DAYS),
            limit: LINK_CANDIDATES + 1,
          },
        });

        return found.ok
          ? found.page.lines.filter((line) => line.id !== lineId).slice(0, LINK_CANDIDATES)
          : [];
      },
      placeholderData: keepPreviousData,
    }),
  /** One line's detail; a line the user does not have comes back as `{ ok: false, code }`. */
  detail: (lineId: string) =>
    queryOptions({
      queryKey: lineKeys.detail(lineId),
      queryFn: () => getLine({ data: { lineId } }),
    }),
};
