import type { Flag, Money } from "@gousset/core";
import { SpendingGroup, addMonths } from "@gousset/core/values";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Count } from "@gousset/ui/components/amount";
import { Page } from "@gousset/ui/components/app-shell";
import { Breakdown, BreakdownSkeleton } from "@gousset/ui/components/breakdown";
import { Delta } from "@gousset/ui/components/delta";
import { FlagList, FlagListSkeleton } from "@gousset/ui/components/flag-list";
import { Folded } from "@gousset/ui/components/folded";
import type { IconName } from "@gousset/ui/components/icons";
import { InvestmentList, InvestmentListSkeleton } from "@gousset/ui/components/investment-list";
import { MonthBar, MonthBarSkeleton } from "@gousset/ui/components/month-bar";
import { MovementList, MovementListSkeleton } from "@gousset/ui/components/movement-list";
import {
  CountChip,
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

import { DataBlock } from "@/components/data-block";
import { MonthSwitch } from "@/components/month-switch";
import { loadBlocks } from "@/lib/load-blocks";
import { monthSearch } from "@/lib/month";
import { useApproveLine } from "@/queries/approve-line";
import { monthQueries } from "@/queries/month";

/** Rows shown before "+ N more": the skeletons have exactly as many. */
const SPENDING_ROWS = 5;
const LINES_TO_REVIEW = 3;
const GROUPS = SpendingGroup.literals;
const TO_REVIEW = "to-review";

const TAB_LABELS = {
  category: () => m.reviewTabCategories(),
  merchant: () => m.reviewTabMerchants(),
  subject: () => m.reviewTabSubjects(),
} satisfies { [group in SpendingGroup]: () => string };

const EMPTY_LABELS = {
  category: () => m.reviewSpendingEmpty(),
  merchant: () => m.reviewSpendingEmpty(),
  subject: () => m.reviewSubjectsEmpty(),
} satisfies { [group in SpendingGroup]: () => string };

const FLAG_ICONS = {
  "price-change": "subscriptions",
  "not-imported": "import",
} satisfies { [kind in Flag["kind"]]: IconName };

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

/** One formatter per language, built once: building one is slow, and a render may need many. */
function perLocale<Made>(make: (locale: string) => Made) {
  const made = new Map<string, Made>();

  return (locale: string) => {
    const known = made.get(locale) ?? make(locale);

    made.set(locale, known);

    return known;
  };
}

const shortDays = perLocale(
  (locale) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }),
);
const plurals = perLocale((locale) => new Intl.PluralRules(locale));
const lists = perLocale((locale) => new Intl.ListFormat(locale, { type: "conjunction" }));
const monthNames = perLocale(
  (locale) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }),
);

/** "24 Oct", "24 oct.": a day in the page's language. */
const shortDay = (day: string, locale: string) => shortDays(locale).format(dateOf(day));

const isOne = (count: number, locale: string) => plurals(locale).select(count) === "one";

export const Route = createFileRoute("/_authed/")({
  validateSearch: monthSearch,
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context: { queryClient, currentMonth }, deps }) => {
    const month = deps.month ?? currentMonth;

    await loadBlocks([
      queryClient.ensureQueryData(monthQueries.summary(month)).then(noop),
      ...GROUPS.map((by) =>
        queryClient.ensureQueryData(monthQueries.spending(month, by)).then(noop),
      ),
      queryClient.ensureQueryData(monthQueries.movements(month)).then(noop),
      queryClient.ensureQueryData(monthQueries.investments(month)).then(noop),
      queryClient.ensureQueryData(monthQueries.imports(month)).then(noop),
      queryClient.ensureQueryData(monthQueries.flags(month)).then(noop),
      queryClient.ensureQueryData(monthQueries.toReview(month)).then(noop),
    ]);

    return { month };
  },
  component: Review,
});

/** The monthly review, the home (docs/wireframes, screens 1 and 11), on the made-up data of v0.1. */
function Review() {
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { month } = Route.useLoaderData();
  const { currentMonth } = Route.useRouteContext();
  // Changing month keeps the month on screen until the next one has its data; then the bars and
  // amounts move to their new values.
  const shown = useDeferredValue(month);
  const linesToReview = useQuery(monthQueries.toReview(shown)).data?.count ?? 0;
  const locale = getLocale();

  // The months a press away are loaded before the press.
  useEffect(() => {
    for (const next of [addMonths(month, -1), addMonths(month, 1)]) {
      if (next <= currentMonth) {
        void router.preloadRoute({ to: "/", search: { month: next } });
      }
    }
  }, [month, currentMonth, router]);

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
        notice={m.reviewMadeUp()}
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
          <DataBlock
            title={m.investmentsTitle()}
            foldOnPhone
            skeleton={<InvestmentListSkeleton />}
            resetKey={shown}
          >
            <Investments month={shown} />
          </DataBlock>
        </ReviewCell>
        {linesToReview === 0 ? null : (
          <ReviewCell column="main" lastOnPhone>
            <DataBlock
              title={m.reviewToReviewTitle()}
              anchor={TO_REVIEW}
              badge={
                <CountChip>
                  <Count value={linesToReview} locale={locale} />
                </CountChip>
              }
              foldOnPhone
              skeleton={<ReviewLinesSkeleton rows={LINES_TO_REVIEW} more />}
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
        </ReviewCell>
      </ReviewGrid>
    </Page>
  );
}

function ImportStatus({ month }: { month: string }) {
  const locale = getLocale();
  const { data: imports } = useSuspenseQuery(monthQueries.imports(month));
  const { data: toReview } = useSuspenseQuery(monthQueries.toReview(month));
  const counts = { imported: imports.imported, accounts: imports.accounts };

  return (
    <>
      <StatusPiece>
        {isOne(imports.accounts, locale)
          ? m.reviewImportedOne(counts)
          : m.reviewImportedOther(counts)}
      </StatusPiece>
      {imports.partial.map((partial) => (
        <StatusPiece key={partial.account}>
          {m.reviewImportedUpTo({
            account: partial.account,
            day: shortDay(partial.coveredTo, locale),
          })}
        </StatusPiece>
      ))}
      {toReview.count === 0 ? null : (
        <StatusPiece>
          <JumpLink to={TO_REVIEW}>
            {isOne(toReview.count, locale)
              ? m.reviewLinesToReviewOne({ count: toReview.count })
              : m.reviewLinesToReviewOther({ count: toReview.count })}
          </JumpLink>
        </StatusPiece>
      )}
    </>
  );
}

function Summary({ month }: { month: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.summary(month));

  return (
    <MonthBar
      received={data.received}
      spent={data.spent}
      saved={data.setAside}
      left={data.left}
      restricted={data.restricted}
      note={lists(locale).format(data.receivedFrom)}
      comparison={
        data.averageSpent === null ? undefined : (
          <>
            {m.reviewSpendingWord()}{" "}
            <Delta
              value={data.spent}
              reference={data.averageSpent}
              referenceLabel={m.reviewAverage()}
              locale={locale}
            />
          </>
        )
      }
      locale={locale}
    />
  );
}

function Spending({ month }: { month: string }) {
  const [by, setBy] = useState<SpendingGroup>("category");

  return (
    <Tabs
      value={by}
      onValueChange={(next) => {
        const group = GROUPS.find((candidate) => candidate === next);

        if (group !== undefined) {
          setBy(group);
        }
      }}
    >
      <TabsList label={m.reviewSpendingTitle()}>
        {GROUPS.map((group) => (
          <Tab key={group} value={group}>
            {TAB_LABELS[group]()}
          </Tab>
        ))}
      </TabsList>
      {GROUPS.map((group) => (
        <TabsPanel key={group} value={group}>
          <Suspense fallback={<BreakdownSkeleton rows={SPENDING_ROWS} more />}>
            <SpendingRows month={month} by={group} />
          </Suspense>
        </TabsPanel>
      ))}
    </Tabs>
  );
}

function SpendingRows({ month, by }: { month: string; by: SpendingGroup }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.spending(month, by));
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const row = data.rows.find((candidate) => candidate.name === open);

  return (
    <Breakdown
      rows={data.rows.map((spent) => ({
        id: spent.name,
        name: spent.name,
        amount: spent.amount,
        benchmark: spent.benchmark ?? undefined,
      }))}
      limit={all ? undefined : SPENDING_ROWS}
      onMore={() => setAll(true)}
      onSelect={setOpen}
      selectedId={row === undefined ? null : row.name}
      onClose={() => setOpen(null)}
      benchmarkLabel={m.reviewAverage()}
      detail={
        row === undefined ? null : (
          <Suspense fallback={<SpendingChartSkeleton />}>
            <RowChart month={month} by={by} name={row.name} />
          </Suspense>
        )
      }
      emptyText={EMPTY_LABELS[by]()}
      footnote={
        data.pending.minor > 0
          ? m.reviewSpendingPending({ amount: formatMoney(data.pending, { locale, whole: true }) })
          : undefined
      }
      locale={locale}
    />
  );
}

function RowChart({ month, by, name }: { month: string; by: SpendingGroup; name: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.spendingDays(month, by, name));

  const monthName = (offset: number) =>
    monthNames(locale).format(dateOf(`${addMonths(month, offset)}-01`));

  return (
    <SpendingChart
      days={data.days.map((day) => ({ ...day, date: dateOf(day.date) }))}
      currency={data.currency}
      label={m.reviewSpendingChart({ name, month: monthName(0), previous: monthName(-1) })}
      currentLabel={monthName(0)}
      previousLabel={monthName(-1)}
    />
  );
}

function Movements({ month }: { month: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.movements(month));

  return (
    <Folded
      title={m.reviewMovementsTitle()}
      summary={<Count value={data.movements.length} locale={locale} />}
    >
      <MovementList
        movements={data.movements.map((movement) => ({
          id: movement.id,
          from: movement.from,
          to: movement.to,
          note: movement.note ?? undefined,
          amount: movement.amount,
          bought: movement.bought ?? undefined,
        }))}
        label={m.reviewMovementsTitle()}
        emptyText={m.reviewMovementsEmpty()}
        locale={locale}
      />
    </Folded>
  );
}

function Investments({ month }: { month: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.investments(month));
  const total = data.accounts.reduce((sum, account) => sum + account.value.minor, 0);
  const currency = data.accounts[0]?.value.currency ?? "EUR";

  return (
    <Folded
      title={m.investmentsTitle()}
      summary={formatMoney({ minor: total, currency }, { locale, whole: true })}
    >
      <InvestmentList
        accounts={data.accounts.map((account) => ({ id: account.account, ...account }))}
        label={m.investmentsTitle()}
        emptyText={m.reviewInvestmentsEmpty()}
        locale={locale}
      />
    </Folded>
  );
}

function ToReview({ month }: { month: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.toReview(month));
  const approve = useApproveLine(month);
  const [all, setAll] = useState(false);

  return (
    <Folded title={m.reviewToReviewTitle()} summary={<Count value={data.count} locale={locale} />}>
      <ReviewLines
        lines={data.lines.map((line) => ({
          id: line.id,
          label: line.label,
          title: line.merchant ?? line.label,
          tags: [line.category, line.account].flatMap((tag) => (tag === null ? [] : [tag])),
          amount: line.amount,
        }))}
        approveText={m.reviewApprove()}
        approveLabel={(line) => m.reviewApproveLine({ label: line.label })}
        onApprove={(id) => approve.mutate(id)}
        limit={all ? undefined : LINES_TO_REVIEW}
        onMore={() => setAll(true)}
        label={m.reviewToReviewTitle()}
        locale={locale}
      />
    </Folded>
  );
}

/** A flag as the page says it: its key, its icon and its sentence. */
function flagRow(flag: Flag, locale: string) {
  const amount = (value: Money) => formatMoney(value, { locale });

  switch (flag.kind) {
    case "price-change": {
      return {
        id: `${flag.kind}-${flag.merchant}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagPriceChange({
          merchant: flag.merchant,
          before: amount(flag.before),
          now: amount(flag.now),
        }),
      };
    }

    case "not-imported": {
      return {
        id: `${flag.kind}-${flag.account}`,
        icon: FLAG_ICONS[flag.kind],
        text: m.reviewFlagNotImported({
          account: flag.account,
          day: shortDay(flag.coveredTo, locale),
        }),
      };
    }
  }
}

function Flags({ month }: { month: string }) {
  const locale = getLocale();
  const { data } = useSuspenseQuery(monthQueries.flags(month));

  return (
    <Folded
      title={m.reviewFlagsTitle()}
      summary={<Count value={data.flags.length} locale={locale} />}
    >
      <FlagList
        flags={data.flags.map((flag) => flagRow(flag, locale))}
        label={m.reviewFlagsTitle()}
        emptyText={m.reviewFlagsEmpty()}
      />
    </Folded>
  );
}
