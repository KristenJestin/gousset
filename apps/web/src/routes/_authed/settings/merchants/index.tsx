import type { MerchantSummary } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Block, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { ErrorState } from "@gousset/ui/components/error-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListSkeleton } from "@gousset/ui/components/list";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { TextField } from "@gousset/ui/components/text-field";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { useDebouncer } from "@tanstack/react-pacer";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ListRowLink } from "@/components/app-link";
import { labelsCount, merchantsCount } from "@/lib/merchant-words";
import { merchantQueries } from "@/queries/merchants";

/** How long the search waits for the typing to stop before it applies. */
const TYPING_WAIT_MS = 300;

/**
 * The user's merchants (#24), by name, recognised from the lines of each import: a search on their
 * names and cleaned labels, a page at a time, each opening its own page.
 *
 * Motion: none of its own. The section fades in as any screen does (200 ms), and a new search
 * keeps the last rows until its own come, so nothing flashes; a merchant's dialogs are on its page.
 */
export const Route = createFileRoute("/_authed/settings/merchants/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureInfiniteQueryData(merchantQueries.list(""));
  },
  component: MerchantsSettings,
});

function MerchantsSettings() {
  const locale = usePageLanguage();
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const typing = useDebouncer(setText, { wait: TYPING_WAIT_MS });
  const merchants = useInfiniteQuery(merchantQueries.list(text.trim()));
  const pages = merchants.data?.pages ?? [];
  const total = pages[0]?.total;
  const rows = pages.flatMap((page) => page.merchants);

  // No merchant at all, as the server says it with no search (not the last search's, kept).
  if (total === 0 && text.trim() === "" && !merchants.isPlaceholderData) {
    return (
      <ScreenBlock>
        <EmptyState
          icon="merchant"
          title={m.merchantsEmptyTitle()}
          description={m.merchantsEmptyDescription()}
        />
      </ScreenBlock>
    );
  }

  return (
    <Block title={m.merchantsTitle()} description={m.merchantsDescription()}>
      <TextField
        type="search"
        label={m.merchantsSearch()}
        placeholder={m.merchantsSearchPlaceholder()}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          typing.maybeExecute(event.target.value);
        }}
        autoComplete="off"
      />
      <StatusMessage message={countOf(total, locale)} />
      {merchants.isError && merchants.data === undefined ? (
        <ErrorState onRetry={() => void merchants.refetch()} />
      ) : (
        <Rows rows={total === undefined ? undefined : rows} locale={locale} />
      )}
      {merchants.hasNextPage ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={merchants.isFetchingNextPage}
            onClick={() => void merchants.fetchNextPage()}
          >
            {m.merchantsShowMore()}
          </Button>
          <FormMessage
            message={merchants.isFetchNextPageError ? m.merchantsMoreFailed() : undefined}
          />
        </div>
      ) : null}
    </Block>
  );
}

/** How many merchants match, said once a list comes. */
function countOf(total: number | undefined, locale: string): string | undefined {
  if (total === undefined) {
    return undefined;
  }

  return total === 0 ? m.merchantsNoMatch() : merchantsCount(total, locale);
}

/** The merchants listed, each opening its page; their skeleton until a first list comes. */
function Rows({
  rows,
  locale,
}: {
  rows: ReadonlyArray<MerchantSummary> | undefined;
  locale: string;
}) {
  if (rows === undefined) {
    return <ListSkeleton label={m.merchantsTitle()} />;
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <List label={m.merchantsTitle()}>
      {rows.map((merchant) => (
        <ListRowLink
          key={merchant.id}
          to="/settings/merchants/$merchantId"
          params={{ merchantId: merchant.id }}
          title={merchant.name}
          description={labelsCount(merchant.aliases, locale)}
        />
      ))}
    </List>
  );
}
