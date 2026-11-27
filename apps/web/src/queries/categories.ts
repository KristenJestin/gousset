import { queryOptions } from "@tanstack/react-query";

import { getCategories } from "@/functions/categories";

import { categoryKeys } from "./category-keys";

// Kept in `invalidate`, which loads no server function, so that it can be tested alone.
export { invalidateCategories } from "./invalidate";

/** The categories, archived ones too, for the categories page and a line's picker alike. */
export const categoryQueries = {
  list: () =>
    queryOptions({
      queryKey: categoryKeys.list(),
      queryFn: () => getCategories(),
    }),
};
