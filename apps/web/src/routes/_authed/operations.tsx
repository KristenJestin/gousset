import type {
  AccountList,
  LineAccount,
  LineDetail as Line,
  LineRow,
  LineTransfer as Transfer,
  TransferSide,
} from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { ErrorState } from "@gousset/ui/components/error-state";
import { FormMessage } from "@gousset/ui/components/form-message";
import { LineDetail } from "@gousset/ui/components/line-detail";
import { LineTransfer, LineTransferCandidates } from "@gousset/ui/components/line-transfer";
import type { TransferSideView } from "@gousset/ui/components/line-transfer";
import { OperationsFilters } from "@gousset/ui/components/operations-filters";
import type { OperationsFilterValues } from "@gousset/ui/components/operations-filters";
import { OperationsLayout } from "@gousset/ui/components/operations-layout";
import { CategoryPicker } from "@gousset/ui/components/category-picker";
import { OperationsList, OperationsListSkeleton } from "@gousset/ui/components/operations-list";
import type { OperationRow } from "@gousset/ui/components/operations-list";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { formatMoney } from "@gousset/ui/lib/money";
import { notify } from "@gousset/ui/lib/notify";
import { hasOperationsFilters } from "@gousset/ui/lib/operations";
import { useDebouncer } from "@tanstack/react-pacer";
import { noop, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";

import { classifyLine, pairLine, unpairLine } from "@/functions/lines";
import type { TransferRefusalCode } from "@/functions/lines";
import { categoryRefusalMessage } from "@/i18n/messages";
import { dayRange, longDay, shortDay, shortDays } from "@/lib/account-day";
import { categoryPath, choicesOf } from "@/lib/categories";
import { loadBlocks } from "@/lib/load-blocks";
import {
  OperationsSearch,
  filtersKey,
  filtersOf,
  lineFiltersOf,
  searchOf,
} from "@/lib/operations-search";
import { accountQueries } from "@/queries/accounts";
import { categoryQueries, invalidateCategories } from "@/queries/categories";
import { invalidateTouched } from "@/queries/invalidate";
import { lineQueries } from "@/queries/lines";

/** How long the search's words and the amounts wait for the typing to stop before they apply. */
const TYPING_WAIT_MS = 300;

/**
 * Every line of every account (issue #21), its filters and the open line in the URL
 * (`?q=greenmarket&account=…&from=2026-10-01&line=…`): an address opens the same list and line.
 */
export const Route = createFileRoute("/_authed/operations")({
  validateSearch: Schema.toStandardSchemaV1(OperationsSearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps }) => {
    const filters = lineFiltersOf(filtersOf(deps));

    // On the server the page waits, so that it is drawn filled; in the browser it opens at once and
    // the list keeps the last search's rows (or its skeleton) until the new one comes.
    await loadBlocks([
      queryClient.ensureInfiniteQueryData(lineQueries.search(filters)).then(noop),
      queryClient.ensureQueryData(accountQueries.list()).then(noop),
      ...(deps.line === undefined
        ? []
        : [
            queryClient.ensureQueryData(lineQueries.detail(deps.line)).then(noop),
            // The open line's category is chosen among them.
            queryClient.ensureQueryData(categoryQueries.list()).then(noop),
          ]),
    ]);
  },
  component: Operations,
});

/** How an account is named on the page: with its institution when another account has its name. */
function accountNames(list: AccountList | undefined) {
  const counts = new Map<string, number>();

  for (const account of [
    ...(list?.groups.flatMap((group) => group.accounts) ?? []),
    ...(list?.closed ?? []),
  ]) {
    counts.set(account.name, (counts.get(account.name) ?? 0) + 1);
  }

  return (account: LineAccount) =>
    (counts.get(account.name) ?? 0) > 1 && account.institution !== null
      ? m.operationsAccountWithInstitution({ name: account.name, institution: account.institution })
      : account.name;
}

/**
 * The filter bar's values and what a change does: the address takes the filters, the words and
 * amounts once the typing stops.
 */
function useFilterBar(applied: OperationsFilterValues) {
  const navigate = Route.useNavigate();
  const appliedKey = filtersKey(applied);

  // What the filter bar shows: ahead of the address while the typing waits.
  const [draft, setDraft] = useState(applied);
  const [seenKey, setSeenKey] = useState(appliedKey);
  // The filters this page last put in the address: coming back, they leave the bar as it is.
  const [sentKey, setSentKey] = useState<string | null>(null);

  // The address changed (Back, a link): the bar follows, unless it is what the page itself sent.
  if (seenKey !== appliedKey) {
    setSeenKey(appliedKey);

    if (appliedKey !== sentKey) {
      setDraft(applied);
    }
  }

  const apply = (values: OperationsFilterValues) => {
    setSentKey(filtersKey(values));
    void navigate({
      search: (previous) => searchOf(values, previous.line),
      replace: true,
      // The list scrolls in itself; the page stays where it is.
      resetScroll: false,
    });
  };

  const typing = useDebouncer(apply, { wait: TYPING_WAIT_MS });

  const change = (values: OperationsFilterValues) => {
    const typed =
      values.accountId === draft.accountId &&
      values.from === draft.from &&
      values.to === draft.to &&
      values.toReview === draft.toReview &&
      hasOperationsFilters(values);

    setDraft(values);

    // Words and amounts wait for the typing to stop; a choice (and "Clear filters") applies at
    // once, with whatever was typed before it.
    if (typed) {
      typing.maybeExecute(values);
    } else {
      typing.cancel();
      apply(values);
    }
  };

  return { draft, change };
}

/**
 * The lines of the applied filters, page after page: the last search's while this one loads, and
 * still the last one's when the server refuses this one (`refusal` says why). When the server
 * fails this search, `failed` says so: neither the last list nor a skeleton stands for it.
 */
function useShownLines(applied: OperationsFilterValues) {
  const lines = useInfiniteQuery(lineQueries.search(lineFiltersOf(applied)));
  const answered = lines.data;
  const first = answered?.pages[0];
  const refusal = first !== undefined && !first.ok ? first.code : undefined;

  // A search the server refuses leaves the last list on screen, the reason under its field.
  const [shown, setShown] = useState(answered);

  if (answered !== undefined && refusal === undefined && answered !== shown) {
    setShown(answered);
  }

  const pages = (shown?.pages ?? []).flatMap((page) => (page.ok ? [page.page] : []));
  const total = pages[0]?.total ?? 0;

  return {
    lines,
    pages,
    refusal,
    /** This search's first page failed (a refetch that fails keeps what it read). */
    failed: lines.isError && answered === undefined,
    /** How many lines match; `undefined` until a first list comes. */
    total: shown === undefined ? undefined : total,
    /** No line at all, as the server says it with no filter (not the last search's, kept). */
    none:
      shown !== undefined &&
      !lines.isPlaceholderData &&
      total === 0 &&
      !hasOperationsFilters(applied) &&
      refusal === undefined,
  };
}

function Operations() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const locale = usePageLanguage();
  const applied = filtersOf(search);
  const { draft, change } = useFilterBar(applied);
  const { lines, pages, refusal, failed, total, none } = useShownLines(applied);
  const { data: accounts } = useQuery(accountQueries.list());
  const nameOf = accountNames(accounts);
  const dayOf = shortDays(locale);

  const rows = pages.flatMap((page) =>
    page.lines.map((line): OperationRow => toRow(line, dayOf, nameOf)),
  );

  const openId = search.line;

  const { data: opened } = useQuery({
    ...lineQueries.detail(openId ?? ""),
    enabled: openId !== undefined,
  });

  // The detail opens once its line is read: the row and the panel change places in one render,
  // which is what lets the panel grow out of the row.
  const open = openId !== undefined && opened?.ok === true ? opened : undefined;

  const openLine = (id: string) => {
    void navigate({ search: (previous) => ({ ...previous, line: id }), resetScroll: false });
  };

  const close = () => {
    void navigate({
      search: (previous) => ({ ...previous, line: undefined }),
      resetScroll: false,
    });
  };

  // The list nears its last loaded row: the next page, unless one is on its way or none is left.
  const readOn = () => {
    if (lines.hasNextPage && !lines.isFetchingNextPage && refusal === undefined) {
      void lines.fetchNextPage();
    }
  };

  if (none) {
    return (
      <Page title={m.operationsTitle()}>
        <ScreenBlock>
          <EmptyState
            icon="operations"
            title={m.operationsEmptyTitle()}
            description={m.operationsEmptyDescription()}
          />
        </ScreenBlock>
      </Page>
    );
  }

  const amountError = refusal === "AMOUNT_INVALID" ? m.operationsAmountRefused() : undefined;

  return (
    <Page title={m.operationsTitle()}>
      <OperationsLayout
        filters={
          <>
            <OperationsFilters
              values={draft}
              onChange={change}
              accounts={accountChoices(accounts, nameOf)}
              minError={draft.min.trim() === "" ? undefined : amountError}
              maxError={draft.max.trim() === "" ? undefined : amountError}
            />
            <FormMessage
              message={refusal === "PERIOD_INVALID" ? m.operationsPeriodRefused() : undefined}
            />
          </>
        }
        count={total}
        list={
          failed ? (
            <ErrorState onRetry={() => void lines.refetch()} />
          ) : total === undefined ? (
            <OperationsListSkeleton />
          ) : (
            <OperationsList
              rows={rows}
              total={total}
              openId={open?.line.id}
              onOpen={openLine}
              onEnd={readOn}
              loadingMore={lines.isFetchingNextPage}
              label={m.operationsTitle()}
              emptyText={m.operationsNoMatch()}
              locale={locale}
              withCategory
            />
          )
        }
        detail={
          open === undefined ? undefined : (
            <OpenLine
              key={open.line.id}
              line={open.line}
              transfer={open.transfer}
              nameOf={nameOf}
              locale={locale}
              onOpen={openLine}
              onClose={close}
            />
          )
        }
        locale={locale}
      />
    </Page>
  );
}

function toRow(
  line: LineRow,
  dayOf: (day: string) => string,
  nameOf: (account: LineAccount) => string,
): OperationRow {
  return {
    id: line.id,
    day: dayOf(line.bookedOn),
    label: line.label,
    account: nameOf(line.account),
    amount: line.amount,
    toReview: line.toReview,
    category: line.category === null ? undefined : categoryPath(line.category),
  };
}

/** Every account the user has, open or closed, to choose one in the filters. */
function accountChoices(list: AccountList | undefined, nameOf: (account: LineAccount) => string) {
  return [...(list?.groups.flatMap((group) => group.accounts) ?? []), ...(list?.closed ?? [])].map(
    (account) => ({ value: account.id, label: nameOf(account) }),
  );
}

/**
 * The open line's category, chosen among the categories of its kind in use (its own too, when it
 * is archived: the line keeps it). The choice shows at once; refused, it goes back to the line's
 * and a toast says why. Done, the lines and the categories are read again.
 */
function LineCategoryPicker({ line }: { line: Line }) {
  const queryClient = useQueryClient();
  const { data: tree } = useQuery(categoryQueries.list());
  const current = line.category;
  const [chosen, setChosen] = useState(current?.id ?? null);

  if (current === null) {
    return null;
  }

  const offered = tree === undefined ? [] : choicesOf(tree, current.kind);

  const listed = offered.some(
    (top) => top.id === current.id || top.children.some((child) => child.id === current.id),
  );

  const categories = listed
    ? offered
    : [...offered, { id: current.id, name: categoryPath(current), children: [] }];

  async function choose(categoryId: string) {
    if (categoryId === chosen) {
      return;
    }

    const before = chosen;

    setChosen(categoryId);

    const answer = await classifyLine({ data: { lineId: line.id, categoryId } }).catch(() => ({
      ok: false as const,
      code: "UNKNOWN",
    }));

    if (!answer.ok) {
      setChosen(before);
      notify.failed({ description: categoryRefusalMessage(answer.code) });

      return;
    }

    await invalidateCategories(queryClient);
  }

  return (
    <CategoryPicker
      label={m.operationsCategory()}
      placeholder={m.categoriesSearch()}
      size="sm"
      categories={categories}
      value={chosen}
      onValueChange={(categoryId) => void choose(categoryId)}
    />
  );
}

/** The import's period, worded: both days, one of them, or neither. */
function periodOf(from: string | null, to: string | null, locale: string): string {
  if (from !== null && to !== null) {
    return dayRange(from, to, locale);
  }

  const day = from ?? to;

  return day === null ? m.operationsPeriodUnknown() : longDay(day, locale);
}

/** A refusal to pair or unpair, worded. */
function transferRefusal(code: TransferRefusalCode): string {
  switch (code) {
    case "LINE_NOT_FOUND": {
      return m.operationsTransferLineGone();
    }

    case "ALREADY_PAIRED": {
      return m.operationsTransferAlreadyPaired();
    }

    case "CANNOT_PAIR": {
      return m.operationsTransferCannotPair();
    }

    case "NOT_A_TRANSFER": {
      return m.operationsTransferNotATransfer();
    }
  }
}

/**
 * What pairing or unpairing two lines touched: the months of both, whose figures count a transfer
 * apart from spending, and with them the lines and the accounts (a side the app made, deleted with
 * its transfer, changes its account's balance).
 */
const touchedBy = (line: Line, other: TransferSide | undefined) => ({
  months: [
    ...new Set([line.bookedOn, other?.bookedOn ?? line.bookedOn].map((day) => day.slice(0, 7))),
  ],
});

/**
 * The open line's transfer: the other side, which `onOpen` opens, and "Not a transfer"; or the
 * lines that may be its other side, to pair with one. Nothing when it is neither.
 */
function TransferOf({
  line,
  transfer,
  nameOf,
  locale,
  onOpen,
}: {
  line: Line;
  transfer: Transfer;
  nameOf: (account: LineAccount) => string;
  locale: string;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();

  const view = (side: TransferSide): TransferSideView => ({
    id: side.id,
    day: shortDay(side.bookedOn, locale),
    label: side.label,
    account: nameOf(side.account),
    amount: side.amount,
  });

  const unpair = async () => {
    try {
      const result = await unpairLine({ data: { lineId: line.id } });

      if (!result.ok) {
        setError(transferRefusal(result.code));

        return;
      }

      setError(undefined);
      await invalidateTouched(queryClient, touchedBy(line, result.other));

      // This line was the side Gousset had made: gone with the transfer, its other side opens.
      if (result.lineDeleted) {
        onOpen(result.other.id);
      }
    } catch {
      setError(m.operationsTransferFailed());
    }
  };

  const pair = async (otherId: string) => {
    try {
      const result = await pairLine({ data: { lineId: line.id, otherId } });

      if (!result.ok) {
        setError(transferRefusal(result.code));

        return false;
      }

      setError(undefined);
      await invalidateTouched(
        queryClient,
        touchedBy(
          line,
          transfer.candidates.find((candidate) => candidate.id === otherId),
        ),
      );

      return true;
    } catch {
      setError(m.operationsTransferFailed());

      return false;
    }
  };

  const { paired, candidates } = transfer;

  if (paired !== null) {
    return (
      <LineTransfer
        direction={paired.direction}
        other={view(paired.other)}
        setAside={paired.setAside}
        madeOn={
          paired.other.madeByApp
            ? nameOf(paired.other.account)
            : line.source === "counterpart"
              ? nameOf(line.account)
              : undefined
        }
        onOpenOther={onOpen}
        onUnpair={unpair}
        error={error}
        locale={locale}
      />
    );
  }

  return candidates.length === 0 ? null : (
    <LineTransferCandidates
      candidates={candidates.map(view)}
      onPair={pair}
      error={error}
      locale={locale}
    />
  );
}

function OpenLine({
  line,
  transfer,
  nameOf,
  locale,
  onOpen,
  onClose,
}: {
  line: Line;
  transfer: Transfer;
  nameOf: (account: LineAccount) => string;
  locale: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const twin = line.duplicateOf;
  const source = line.import;

  return (
    <LineDetail
      category={line.category === null ? undefined : <LineCategoryPicker line={line} />}
      id={line.id}
      label={line.label}
      amount={line.amount}
      account={nameOf(line.account)}
      bookedOn={longDay(line.bookedOn, locale)}
      valueOn={line.valueOn === null ? undefined : longDay(line.valueOn, locale)}
      rawLabel={line.label}
      memo={line.memo ?? undefined}
      counterparty={line.counterpartyName ?? undefined}
      originalAmount={line.originalAmount ?? undefined}
      expiresOn={line.expiresOn === null ? undefined : longDay(line.expiresOn, locale)}
      looksLike={
        twin === null
          ? undefined
          : m.operationsLooksLike({
              day: shortDay(twin.bookedOn, locale),
              label: twin.label,
              amount: formatMoney(twin.amount, { locale }),
            })
      }
      importedFrom={
        source === null
          ? undefined
          : {
              fileName: source.fileName,
              // The day the file was dropped, as the server's clock wrote it (UTC).
              importedOn: longDay(source.importedAt.slice(0, 10), locale),
              period: periodOf(source.periodFrom, source.periodTo, locale),
            }
      }
      transfer={
        <TransferOf
          line={line}
          transfer={transfer}
          nameOf={nameOf}
          locale={locale}
          onOpen={onOpen}
        />
      }
      onClose={onClose}
      locale={locale}
    />
  );
}
