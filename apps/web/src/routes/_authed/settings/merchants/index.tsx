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
import { MerchantForm } from "@/components/merchant-form";
import { merchantAvatar } from "@/lib/merchant-logo";
import { labelsCount, merchantsCount } from "@/lib/merchant-words";
import { merchantQueries } from "@/queries/merchants";

/** How long the search waits for the typing to stop before it applies. */
const TYPING_WAIT_MS = 300;

/**
 * The user's merchants (#24), by name, recognised from the lines of each import or made by hand
 * (#204): a search on their names and cleaned labels, a page at a time, each row with the
 * merchant's logo or initials and opening its own page; a payment intermediary (#30) says so under
 * its name. "New merchant", beside the title, opens the merchant's form in a side sheet; once made,
 * its page shows it.
 *
 * Motion: none of its own. The section fades in as any screen does (200 ms), and a new search
 * keeps the last rows until its own come, so nothing flashes; the form's sheet slides in from its
 * edge (300 ms) and out (200 ms), cut under reduced motion (`MerchantForm`).
 */
export const Route = createFileRoute("/_authed/settings/merchants/")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureInfiniteQueryData(merchantQueries.list(""));
  },
  component: MerchantsSettings,
});

function MerchantsSettings() {
  const locale = usePageLanguage();
  const navigate = Route.useNavigate();
  const [typed, setTyped] = useState("");
  const [text, setText] = useState("");
  const typing = useDebouncer(setText, { wait: TYPING_WAIT_MS });
  const merchants = useInfiniteQuery(merchantQueries.list(text.trim()));
  const pages = merchants.data?.pages ?? [];
  const total = pages[0]?.total;
  const rows = pages.flatMap((page) => page.merchants);
  // The form's openings, each a new form; open while `open`.
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);

  const newMerchant = (
    <Button
      icon="add"
      onClick={() => {
        setOpened(opened + 1);
        setOpen(true);
      }}
    >
      {m.merchantsNew()}
    </Button>
  );

  const form =
    opened === 0 ? null : (
      <MerchantForm
        key={opened}
        open={open}
        onOpenChange={setOpen}
        onSaved={(made) =>
          void navigate({
            to: "/settings/merchants/$merchantId",
            params: { merchantId: made.id },
          })
        }
      />
    );

  // No merchant at all, as the server says it with no search (not the last search's, kept). The
  // form stays in one place either way: a merchant made there, whose logo was refused, ends the
  // empty state and must keep its form.
  if (total === 0 && text.trim() === "" && !merchants.isPlaceholderData) {
    return (
      <>
        <ScreenBlock>
          <EmptyState
            icon="merchant"
            title={m.merchantsEmptyTitle()}
            description={m.merchantsEmptyDescription()}
            links={newMerchant}
          />
        </ScreenBlock>
        {form}
      </>
    );
  }

  return (
    <>
      <Block
        title={m.merchantsTitle()}
        description={m.merchantsDescription()}
        actions={newMerchant}
      >
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
      {form}
    </>
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
          avatar={merchantAvatar(merchant)}
          description={
            merchant.intermediary
              ? m.merchantsLabelsIntermediary({ labels: labelsCount(merchant.aliases, locale) })
              : labelsCount(merchant.aliases, locale)
          }
        />
      ))}
    </List>
  );
}
