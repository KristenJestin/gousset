import type {
  CategorySpending,
  MerchantSpending,
  Money,
  MonthFlag,
  MonthReview,
  SpendingBy,
  SubscriptionCalendar,
} from "@gousset/core";
import { addMonths } from "@gousset/core/values";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import type { Locale } from "@gousset/i18n/runtime";
import { Count } from "@gousset/ui/components/amount";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Breakdown, BreakdownFigures, BreakdownSkeleton } from "@gousset/ui/components/breakdown";
import type { BreakdownComparison, BreakdownRow } from "@gousset/ui/components/breakdown";
import { DeltaList } from "@gousset/ui/components/delta";
import type { DeltaListItem } from "@gousset/ui/components/delta";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FlagList, FlagListSkeleton } from "@gousset/ui/components/flag-list";
import { Folded } from "@gousset/ui/components/folded";
import { isIconName } from "@gousset/ui/components/icons";
import type { IconName } from "@gousset/ui/components/icons";
import { MonthBar, MonthBarSkeleton } from "@gousset/ui/components/month-bar";
import { MovementList, MovementListSkeleton } from "@gousset/ui/components/movement-list";
import { RecurringCalendar } from "@gousset/ui/components/recurring-calendar";
import type { RecurringItem } from "@gousset/ui/components/recurring-calendar";
import {
  CountChip,
  CountChipSkeleton,
  JumpLink,
  ReviewCell,
  ReviewGrid,
  ReviewStatus,
  StatusPiece,
} from "@gousset/ui/components/review-layout";
import { ReviewLines, ReviewLinesSkeleton } from "@gousset/ui/components/review-lines";
import { SpendingChart, SpendingChartSkeleton } from "@gousset/ui/components/spending-chart";
import { Tab, Tabs, TabsList, TabsPanel } from "@gousset/ui/components/tabs";
import { formatMoney } from "@gousset/ui/lib/money";
import { noop, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Suspense, useDeferredValue, useEffect, useState } from "react";

import { AppButtonLink, AppLink } from "@/components/app-link";
import { DataBlock } from "@/components/data-block";
import { MonthSwitch } from "@/components/month-switch";
import { shortDay } from "@/lib/account-day";
import { categoryPath } from "@/lib/categories";
import { loadBlocks } from "@/lib/load-blocks";
import { monthSearch } from "@/lib/month";
import { monthQueries } from "@/queries/month";
import { reviewQueries } from "@/queries/review";

/** Rows shown before "+ N more": the skeletons have exactly as many. */
const SPENDING_ROWS = 5;

/** The lines to review the month lists at most (`LINES_TO_REVIEW_SHOWN` in @gousset/core). */
const LINES_TO_REVIEW = 3;

const TO_REVIEW = "to-review";

/** The id of the merchants' row of none, which has no merchant's id. */
const NO_MERCHANT = "no-merchant";

const FLAG_ICONS = {
  drift: "warning",
  "price-rise": "up",
  stopped: "error",
  expiring: "expiring",
  "not-imported": "import",
} satisfies { [Kind in MonthFlag["kind"]]: IconName };

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

// The formatters, one per language, built once when the module loads: building one is slow, and a
// render may need many.
const plurals = {
  en: new Intl.PluralRules("en"),
  fr: new Intl.PluralRules("fr"),
} satisfies { [Language in Locale]: Intl.PluralRules };

const numbers = {
  en: new Intl.NumberFormat("en"),
  fr: new Intl.NumberFormat("fr"),
} satisfies { [Language in Locale]: Intl.NumberFormat };

const lists = {
  en: new Intl.ListFormat("en", { type: "conjunction" }),
  fr: new Intl.ListFormat("fr", { type: "conjunction" }),
} satisfies { [Language in Locale]: Intl.ListFormat };

const monthNames = {
  en: new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }),
  fr: new Intl.DateTimeFormat("fr", { month: "long", timeZone: "UTC" }),
} satisfies { [Language in Locale]: Intl.DateTimeFormat };

const isOne = (count: number, locale: Locale) => plurals[locale].select(count) === "one";

/** "October", "octobre": a month `YYYY-MM` by its name, in the page's language. */
const monthName = (month: string, locale: Locale) =>
  monthNames[locale].format(dateOf(`${month}-01`));

/** The month a review opens on: the address's, never one to come; today's when it names none. */
const monthShown = (asked: string | undefined, currentMonth: string) =>
  asked === undefined || asked > currentMonth ? currentMonth : asked;

export const Route = createFileRoute("/_authed/")({
  validateSearch: monthSearch,
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context: { queryClient, currentMonth }, deps }) => {
    const month = monthShown(deps.month, currentMonth);

    // On the server the page waits, so that it is drawn filled; in the browser each block waits
    // in its own skeleton, unless the month came with a preload.
    await loadBlocks([
      queryClient.ensureQueryData(reviewQueries.startingPoints()).then(noop),
      queryClient.ensureQueryData(monthQueries.review(month)).then(noop),
    ]);

    return { month };
  },
  component: Review,
});

/**
 * The monthly review, the home (docs/wireframes, screens 1 and 11, #32): the user's own month, in
 * their currency; a user with no line at all is led to the first import instead.
 */
function Review() {
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { month } = Route.useLoaderData();
  const { currentMonth } = Route.useRouteContext();
  // Changing month keeps the month on screen until the next one has its data; then the bars and
  // amounts move to their new values.
  const shown = useDeferredValue(month);
  const { data: counts } = useQuery(reviewQueries.startingPoints());
  // Unknown while it loads: the block is there, with its skeleton, until the month has no line.
  const linesToReview = useQuery(monthQueries.review(shown)).data?.review.linesToReview.count;
  const locale = getLocale();

  // The months a press away are loaded before the press.
  useEffect(() => {
    for (const next of [addMonths(month, -1), addMonths(month, 1)]) {
      if (next <= currentMonth) {
        void router.preloadRoute({ to: "/", search: { month: next } });
      }
    }
  }, [month, currentMonth, router]);

  if (counts !== undefined && counts.lines + counts.toReview === 0) {
    return <FirstImport />;
  }

  return (
    <Page
      title={m.reviewTitle()}
      actions={
        <MonthSwitch
          month={shown}
          currentMonth={currentMonth}
          onChange={(next) => void navigate({ search: { month: next } })}
        />
      }
    >
      <ReviewStatus
        status={
          <Suspense fallback={null}>
            <ImportStatus month={shown} />
          </Suspense>
        }
      />
      <DataBlock title={m.reviewSummaryTitle()} skeleton={<MonthBarSkeleton />} resetKey={shown}>
        <Summary month={shown} />
      </DataBlock>
      <ReviewGrid>
        <ReviewCell column="main">
          <DataBlock
            title={m.reviewSpendingTitle()}
            skeleton={<BreakdownSkeleton rows={SPENDING_ROWS} more />}
            resetKey={shown}
          >
            <Spending month={shown} />
          </DataBlock>
        </ReviewCell>
        <ReviewCell column="side">
          <DataBlock
            title={m.reviewMovementsTitle()}
            aside={m.reviewMovementsAside()}
            foldOnPhone
            skeleton={<MovementListSkeleton />}
            resetKey={shown}
          >
            <Movements month={shown} />
          </DataBlock>
        </ReviewCell>
        {linesToReview === 0 ? null : (
          <ReviewCell column="main" lastOnPhone>
            <DataBlock
              title={m.reviewToReviewTitle()}
              anchor={TO_REVIEW}
              badge={
                linesToReview === undefined ? (
                  <CountChipSkeleton />
                ) : (
                  <CountChip>
                    <Count value={linesToReview} locale={locale} />
                  </CountChip>
                )
              }
              foldOnPhone
              skeleton={<ReviewLinesSkeleton rows={LINES_TO_REVIEW} more readOnly />}
              resetKey={shown}
            >
              <ToReview month={shown} />
            </DataBlock>
          </ReviewCell>
        )}
        <ReviewCell column="side">
          <DataBlock
            title={m.reviewFlagsTitle()}
            foldOnPhone
            skeleton={<FlagListSkeleton />}
            resetKey={shown}
          >
            <Flags month={shown} />
          </DataBlock>
          <DataBlock
            title={m.reviewCalendarTitle()}
            foldOnPhone
            skeleton={<FlagListSkeleton rows={3} />}
            resetKey={shown}
          >
            {/* Another month starts on its own month again. */}
            <Calendar key={shown} month={shown} currentMonth={currentMonth} />
          </DataBlock>
        </ReviewCell>
      </ReviewGrid>
    </Page>
  );
}

/** A user with no line at all: one empty state that leads to the first import, not a page of zeros. */
function FirstImport() {
  return (
    <Page title={m.reviewTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="import"
          title={m.reviewEmptyTitle()}
          description={m.reviewEmptyDescription()}
          links={
            <>
              <AppButtonLink to="/import">{m.reviewEmptyImport()}</AppButtonLink>
              <AppButtonLink to="/accounts" variant="secondary">
                {m.navAccounts()}
              </AppButtonLink>
            </>
          }
        />
      </ScreenBlock>
    </Page>
  );
}

/** The month's review, as every block reads it: one query, filled on the first paint. */
function useMonthReview(month: string): MonthReview {
  return useSuspenseQuery(monthQueries.review(month)).data.review;
}

function useCalendar(month: string): SubscriptionCalendar {
  return useSuspenseQuery(monthQueries.review(month)).data.calendar;
}

/** The state line: how far the statements go, and the link down to the lines to review. */
function ImportStatus({ month }: { month: string }) {
  const locale = getLocale();
  const { importState, linesToReview } = useMonthReview(month);
  const number = numbers[locale];

  const counts = {
    imported: number.format(importState.imported),
    accounts: number.format(importState.accounts),
  };

  const count = { count: number.format(linesToReview.count) };

  return (
    <>
      {importState.accounts === 0 ? null : (
        <StatusPiece>
          {isOne(importState.accounts, locale)
            ? m.reviewImportedOne(counts)
            : m.reviewImportedOther(counts)}
        </StatusPiece>
      )}
      {importState.partial.map((partial) =>
        partial.reached === null ? null : (
          <StatusPiece key={partial.accountId}>
            {m.reviewImportedUpTo({
              account: partial.account,
              day: shortDay(partial.reached, locale),
            })}
          </StatusPiece>
        ),
      )}
      {linesToReview.count === 0 ? null : (
        <StatusPiece>
          <JumpLink to={TO_REVIEW}>
            {isOne(linesToReview.count, locale)
              ? m.reviewLinesToReviewOne(count)
              : m.reviewLinesToReviewOther(count)}
          </JumpLink>
        </StatusPiece>
      )}
    </>
  );
}

function Summary({ month }: { month: string }) {
  const locale = getLocale();
  const { summary } = useMonthReview(month);
  const whole = (money: Money) => formatMoney(money, { locale, whole: true });
  const comparisons: Array<DeltaListItem> = [];

  if (summary.averageSpent !== null) {
    comparisons.push({
      id: "average",
      label: m.reviewAverageShort(),
      value: summary.spent,
      reference: summary.averageSpent,
      referenceLabel: m.reviewAverageReference(),
    });
  }

  if (summary.previousSpent !== null) {
    const previous = monthName(summary.previousMonth, locale);

    comparisons.push({
      id: "previous",
      label: m.reviewMonthShort({ month: previous }),
      value: summary.spent,
      reference: summary.previousSpent,
      referenceLabel: previous,
    });
  }

  return (
    <MonthBar
      received={summary.received}
      spent={summary.spent}
      saved={summary.setAside}
      left={summary.left}
      restricted={summary.restricted.minor > 0 ? summary.restricted : undefined}
      note={
        summary.receivedFrom.length === 0
          ? undefined
          : lists[locale].format(summary.receivedFrom.map((from) => from.name))
      }
      comparison={
        comparisons.length === 0 ? undefined : (
          <DeltaList lead={m.reviewSpendingWord()} items={comparisons} />
        )
      }
      notes={summary.elsewhere.map((other) =>
        m.reviewOtherCurrency({
          currency: other.currency,
          received: whole(other.received),
          spent: whole(other.spent),
          setAside: whole(other.setAside),
          left: whole(other.left),
        }),
      )}
      locale={locale}
    />
  );
}

function isSpendingBy(value: string): value is SpendingBy {
  return value === "category" || value === "merchant";
}

function Spending({ month }: { month: string }) {
  const [by, setBy] = useState<SpendingBy>("category");

  return (
    <Tabs
      value={by}
      onValueChange={(next) => {
        if (isSpendingBy(next)) {
          setBy(next);
        }
      }}
    >
      <TabsList label={m.reviewSpendingTitle()}>
        <Tab value="category">{m.reviewTabCategories()}</Tab>
        <Tab value="merchant">{m.reviewTabMerchants()}</Tab>
      </TabsList>
      {/* The tabs are there at once; each panel's rows wait in their own skeleton. */}
      <TabsPanel value="category">
        <Suspense fallback={<BreakdownSkeleton rows={SPENDING_ROWS} more />}>
          <CategoryRows month={month} />
        </Suspense>
      </TabsPanel>
      <TabsPanel value="merchant">
        <Suspense fallback={<BreakdownSkeleton rows={SPENDING_ROWS} more />}>
          <MerchantRows month={month} />
        </Suspense>
      </TabsPanel>
    </Tabs>
  );
}

/** A top-level category as a row: its benchmark's mark, read as set when the user set it. */
function categoryRow(category: CategorySpending): BreakdownRow {
  const { benchmark } = category;

  return {
    id: category.id,
    name: category.name,
    icon: category.icon !== null && isIconName(category.icon) ? category.icon : undefined,
    amount: category.spent,
    benchmark:
      benchmark.mode === "none" || benchmark.amount === null ? undefined : benchmark.amount,
    benchmarkSet: benchmark.mode === "fixed",
  };
}

/** A merchant as a row, in the page's words: an intermediary said so, the row of none named. */
function merchantRow(merchant: MerchantSpending): BreakdownRow {
  const name =
    merchant.name === null
      ? m.reviewNoMerchant()
      : merchant.intermediary
        ? m.reviewViaIntermediary({ name: merchant.name })
        : merchant.name;

  return { id: merchant.id ?? NO_MERCHANT, name, icon: "merchant", amount: merchant.spent };
}

function CategoryRows({ month }: { month: string }) {
  const { categories } = useMonthReview(month);

  return (
    <SpendingRows
      month={month}
      by="category"
      rows={categories.rows.map((category) => ({ row: categoryRow(category), figures: category }))}
    />
  );
}

function MerchantRows({ month }: { month: string }) {
  const { merchants } = useMonthReview(month);

  return (
    <SpendingRows
      month={month}
      by="merchant"
      rows={merchants.rows.map((merchant) => ({ row: merchantRow(merchant), figures: merchant }))}
    />
  );
}

/** A row of "where the money goes", with what its detail holds it against. */
type SpendingEntry = {
  row: BreakdownRow;
  figures: { readonly average: Money | null; readonly previous: Money | null };
};

function SpendingRows({
  month,
  by,
  rows,
}: {
  month: string;
  by: SpendingBy;
  rows: ReadonlyArray<SpendingEntry>;
}) {
  const locale = getLocale();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const entry = rows.find((candidate) => candidate.row.id === open);
  const previous = monthName(addMonths(month, -1), locale);

  const comparisons = (figures: SpendingEntry["figures"]) => {
    const against: Array<BreakdownComparison> = [];

    if (figures.average !== null) {
      against.push({
        id: "average",
        label: m.reviewAverage(),
        reference: figures.average,
        referenceLabel: m.reviewAverageReference(),
      });
    }

    if (figures.previous !== null) {
      against.push({
        id: "previous",
        label: previous.charAt(0).toLocaleUpperCase(locale) + previous.slice(1),
        reference: figures.previous,
        referenceLabel: previous,
      });
    }

    return against;
  };

  return (
    <Breakdown
      rows={rows.map((each) => each.row)}
      limit={all ? undefined : SPENDING_ROWS}
      onMore={() => setAll(true)}
      onSelect={setOpen}
      selectedId={entry === undefined ? null : entry.row.id}
      onClose={() => setOpen(null)}
      detail={
        entry === undefined ? null : (
          <BreakdownFigures
            value={entry.row.amount}
            comparisons={comparisons(entry.figures)}
            label={m.reviewFiguresLabel({ name: entry.row.name })}
            locale={locale}
          >
            <Suspense fallback={<SpendingChartSkeleton />}>
              <RowChart
                month={month}
                by={by}
                id={entry.row.id === NO_MERCHANT ? null : entry.row.id}
                name={entry.row.name}
              />
            </Suspense>
          </BreakdownFigures>
        )
      }
      emptyText={m.reviewSpendingEmpty()}
      locale={locale}
    />
  );
}

function RowChart({
  month,
  by,
  id,
  name,
}: {
  month: string;
  by: SpendingBy;
  id: string | null;
  name: string;
}) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.spendingDays(month, by, id));
  const current = monthName(month, locale);
  const previous = monthName(addMonths(month, -1), locale);

  return (
    <SpendingChart
      days={data.days.map((day) => ({ ...day, date: dateOf(day.date) }))}
      currency={data.currency}
      label={m.reviewSpendingChart({ name, month: current, previous })}
      currentLabel={current}
      previousLabel={previous}
    />
  );
}

function Movements({ month }: { month: string }) {
  const locale = getLocale();
  const { movements } = useMonthReview(month);

  return (
    <Folded
      title={m.reviewMovementsTitle()}
      summary={<Count value={movements.movements.length} locale={locale} />}
    >
      <MovementList
        movements={movements.movements.map((movement, index) => ({
          id: `${movement.day}-${String(index)}`,
          from: movement.from,
          to: movement.to,
          note: movement.note ?? undefined,
          amount: movement.amount,
        }))}
        label={m.reviewMovementsTitle()}
        emptyText={m.reviewMovementsEmpty()}
        locale={locale}
      />
    </Folded>
  );
}

/** A flag as the page says it: its key, its icon and its sentence. */
function flagRow(flag: MonthFlag, locale: Locale) {
  const exact = (value: Money) => formatMoney(value, { locale });
  const whole = (value: Money) => formatMoney(value, { locale, whole: true });
  const day = (value: string) => shortDay(value, locale);

  switch (flag.kind) {
    case "drift": {
      return {
        id: `${flag.kind}-${flag.categoryId}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagDrift({
          name: flag.name,
          spent: whole(flag.spent),
          benchmark: whole(flag.benchmark),
        }),
      };
    }

    case "price-rise": {
      return {
        id: `${flag.kind}-${flag.merchant}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagPriceRise({
          merchant: flag.merchant,
          from: exact(flag.from),
          to: exact(flag.to),
        }),
      };
    }

    case "stopped": {
      return {
        id: `${flag.kind}-${flag.merchant}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagStopped({
          merchant: flag.merchant,
          day: day(flag.expectedOn),
          amount: exact(flag.last),
          last: day(flag.lastOn),
        }),
      };
    }

    case "expiring": {
      return {
        id: `${flag.kind}-${flag.accountId}-${flag.day}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagExpiring({
          amount: exact(flag.amount),
          account: flag.account,
          day: day(flag.day),
        }),
      };
    }

    case "not-imported": {
      return {
        id: `${flag.kind}-${flag.accountId}`,
        icon: FLAG_ICONS[flag.kind],
        text:
          flag.reached === null
            ? m.reviewFlagImportedNone({ account: flag.account })
            : m.reviewFlagImportedUpTo({ account: flag.account, day: day(flag.reached) }),
      };
    }
  }
}

function Flags({ month }: { month: string }) {
  const locale = getLocale();
  const { flags } = useMonthReview(month);

  return (
    <Folded
      title={m.reviewFlagsTitle()}
      summary={<Count value={flags.flags.length} locale={locale} />}
    >
      <FlagList
        flags={flags.flags.map((flag) => flagRow(flag, locale))}
        label={m.reviewFlagsTitle()}
        emptyText={m.reviewFlagsEmpty()}
      />
    </Folded>
  );
}

/** A day of the calendar as the component draws it. */
function calendarItem(item: SubscriptionCalendar["items"][number]): RecurringItem {
  return {
    id: item.id,
    day: item.day,
    kind: item.kind,
    name: item.name,
    amount: item.amount,
    priceRise: item.kind === "expiring" ? null : item.priceRise,
  };
}

/**
 * The recurring payments of the month and the next (#34), read only. In today's month it moves to
 * the next one; a past month's is only named.
 */
function Calendar({ month, currentMonth }: { month: string; currentMonth: string }) {
  const locale = getLocale();
  const calendar = useCalendar(month);
  const { today } = useMonthReview(month);
  // Today's month may move on to the next one, which the calendar holds too.
  const [next, setNext] = useState(false);
  const shownMonth = next ? addMonths(month, 1) : month;
  const items = calendar.items.map(calendarItem);
  const inMonth = items.filter((item) => item.day.startsWith(`${shownMonth}-`));

  return (
    <Folded
      title={m.reviewCalendarTitle()}
      summary={<Count value={inMonth.length} locale={locale} />}
    >
      <RecurringCalendar
        month={shownMonth}
        today={today}
        items={items}
        defaultView="agenda"
        onMonthChange={month === currentMonth ? (chosen) => setNext(chosen !== month) : undefined}
      />
    </Folded>
  );
}

function ToReview({ month }: { month: string }) {
  const locale = getLocale();
  const { linesToReview } = useMonthReview(month);

  return (
    <Folded
      title={m.reviewToReviewTitle()}
      summary={<Count value={linesToReview.count} locale={locale} />}
    >
      <ReviewLines
        lines={linesToReview.lines.map((line) => ({
          id: line.id,
          label: line.label,
          title: line.category === null ? line.label : categoryPath(line.category),
          tags: [line.account.name, shortDay(line.day, locale)],
          amount: line.amount,
        }))}
        footer={
          <AppLink to="/operations" search={{ review: true, month }}>
            {m.reviewToReviewLink()}
          </AppLink>
        }
        label={m.reviewToReviewTitle()}
        locale={locale}
      />
    </Folded>
  );
}
