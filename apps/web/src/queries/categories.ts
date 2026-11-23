import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getCategories } from "@/functions/categories";

import { categoryKeys } from "./category-keys";
import { lineKeys } from "./line-keys";
import { monthKeys } from "./month-keys";

/** The categories, archived ones too, for the categories page and a line's picker alike. */
export const categoryQueries = {
  list: () =>
    queryOptions({
      queryKey: categoryKeys.list(),
      queryFn: () => getCategories(),
    }),
};

/**
 * After a change of the categories or of a line's category: the categories' figures and lines,
 * each line's category (the operations name it), and the months' spending by category may all
 * have changed, so each is read again.
 */
export async function invalidateCategories(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
    queryClient.invalidateQueries({ queryKey: lineKeys.all }),
    queryClient.invalidateQueries({ queryKey: monthKeys.all }),
  ]);
}
