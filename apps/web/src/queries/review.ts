import { queryOptions } from "@tanstack/react-query";

import { getStartingPoints } from "@/functions/review";

import { reviewKeys } from "./review-keys";

/** The review's queries, for its loader and its component alike. */
export const reviewQueries = {
  /** The user's own counts on the screens that work today, until the review ships (#126). */
  startingPoints: () =>
    queryOptions({
      queryKey: reviewKeys.startingPoints(),
      queryFn: () => getStartingPoints(),
    }),
};
