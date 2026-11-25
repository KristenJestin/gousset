import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { getMerchant, getMerchants } from "@/functions/merchants";

import { merchantKeys } from "./merchant-keys";

/** Merchants a page: a long screen of rows; "Show more" reads the next. */
const PAGE_MERCHANTS = 50;

/** How many names a name field offers while the user types. */
const SUGGESTED = 8;

/**
 * The merchants a rule's picker offers, found by typing among them: the most the server lists at
 * once (`MAX_MERCHANTS_LISTED`), more than one person's merchants.
 */
const CHOICES = 500;

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
  /**
   * The merchants a rule may set, by name: the first `CHOICES`, each saying whether it is a payment
   * intermediary, which is never who a line paid (#30).
   */
  choices: () =>
    queryOptions({
      queryKey: merchantKeys.choices(),
      queryFn: async () => {
        const page = await getMerchants({ data: { limit: CHOICES } });

        return page.merchants.map((merchant) => ({
          id: merchant.id,
          name: merchant.name,
          intermediary: merchant.intermediary,
        }));
      },
    }),
  /** One merchant's page; one the user does not have comes back as `{ ok: false, code }`. */
  detail: (merchantId: string) =>
    queryOptions({
      queryKey: merchantKeys.detail(merchantId),
      queryFn: () => getMerchant({ data: { merchantId } }),
    }),
};

/**
 * After a rename: the lists (names, order) and the merchants' pages may all have changed, so every
 * merchants query is read again. A merge, a label moved or a default category set move entries
 * too: `invalidateMerchantEntries`.
 */
export async function invalidateMerchants(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: merchantKeys.all });
}
