import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getMerchant, getMerchants } from "@/functions/merchants";

import { merchantKeys } from "./merchant-keys";

/** Merchants a page: a long screen of rows; "Show more" reads the next. */
const PAGE_MERCHANTS = 50;

/** How many names a name field offers while the user types. */
const SUGGESTED = 8;

/** The queries of the merchants pages, for their loaders and components alike. */
export const merchantQueries = {
  /**
   * The merchants whose name or a cleaned label contains `text` (blank for all), a page at a time:
   * each page's `next` is the cursor of the one after it. While another search loads, the last
   * one's rows stay on screen (`keepPreviousData`) rather than giving way to a skeleton.
   */
  list: (text: string) =>
    infiniteQueryOptions({
      queryKey: merchantKeys.list(text),
      queryFn: ({ pageParam }) =>
        getMerchants({ data: { text, after: pageParam, limit: PAGE_MERCHANTS } }),
      initialPageParam: "",
      getNextPageParam: (last) => last.next ?? undefined,
      placeholderData: keepPreviousData,
    }),
  /** The few merchants' names a name field offers for `text`; none while it is blank. */
  names: (text: string) =>
    queryOptions({
      queryKey: merchantKeys.names(text),
      queryFn: async () => {
        const page = await getMerchants({ data: { text, limit: SUGGESTED } });

        return page.merchants.map((merchant) => merchant.name);
      },
      enabled: text.trim() !== "",
      placeholderData: keepPreviousData,
    }),
  /** One merchant's page; one the user does not have comes back as `{ ok: false, code }`. */
  detail: (merchantId: string) =>
    queryOptions({
      queryKey: merchantKeys.detail(merchantId),
      queryFn: () => getMerchant({ data: { merchantId } }),
    }),
};

/**
 * After a rename, a merge or a label moved: the lists (names, counts, order) and the merchants'
 * pages may all have changed, so every merchants query is read again.
 */
export async function invalidateMerchants(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: merchantKeys.all });
}
