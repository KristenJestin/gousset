import { queryOptions } from "@tanstack/react-query";

import { getQueuedLine, getStartingPoints } from "@/functions/review";

import { reviewKeys } from "./review-keys";

/** The review's queries, for its loader and its component alike. */
export const reviewQueries = {
  /** The user's own counts on the screens that work today, until the review ships (#126). */
  startingPoints: () =>
    queryOptions({
      queryKey: reviewKeys.startingPoints(),
      queryFn: () => getStartingPoints(),
    }),
  /**
   * A line to review and what Gousset proposes for it (#35); a line the user does not have, or no
   * longer to review, comes back as `{ ok: false, code }`.
   */
  line: (lineId: string) =>
    queryOptions({
      queryKey: reviewKeys.line(lineId),
      queryFn: () => getQueuedLine({ data: { lineId } }),
    }),
};
