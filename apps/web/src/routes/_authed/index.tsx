import type { Flag, Money } from "@gousset/core";
import { Month, SpendingGroup, addMonths } from "@gousset/core/values";
import { Count } from "@gousset/ui/components/amount";
import { Breakdown, BreakdownSkeleton } from "@gousset/ui/components/breakdown";
import { Delta } from "@gousset/ui/components/delta";
import { FlagList, FlagListSkeleton } from "@gousset/ui/components/flag-list";
import { Folded } from "@gousset/ui/components/folded";
import { InvestmentList, InvestmentListSkeleton } from "@gousset/ui/components/investment-list";
import { MonthBar, MonthBarSkeleton } from "@gousset/ui/components/month-bar";
import { MonthSwitcher } from "@gousset/ui/components/month-switcher";
import { MovementList, MovementListSkeleton } from "@gousset/ui/components/movement-list";
import {
  CountChip,
  JumpLink,
  ReviewCell,
  ReviewGrid,
  ReviewHeader,
  ReviewPage,
  StatusPiece,
} from "@gousset/ui/components/review-layout";
import { ReviewLines, ReviewLinesSkeleton } from "@gousset/ui/components/review-lines";
import { SpendingChart, SpendingChartSkeleton } from "@gousset/ui/components/spending-chart";
import { Tab, Tabs, TabsList, TabsPanel } from "@gousset/ui/components/tabs";
import { formatMoney } from "@gousset/ui/lib/money";
import { noop, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { Suspense, useDeferredValue, useEffect, useState } from "react";

import { DataBlock } from "@/components/data-block";
import type { Locale } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { loadBlocks } from "@/lib/load-blocks";
import { useApproveLine } from "@/queries/approve-line";
import { monthQueries } from "@/queries/month";

const monthNameOptions = { month: "long", year: "numeric", timeZone: "UTC" } as const;

/** "October 2026", in each language of the interface. */
const monthNames = {
  en: new Intl.DateTimeFormat("en", monthNameOptions),
  fr: new Intl.DateTimeFormat("fr", monthNameOptions),
} satisfies { [locale in Locale]: Intl.DateTimeFormat };

const shortDayOptions = { day: "numeric", month: "short", timeZone: "UTC" } as const;

/** "24 Oct", in each language of the interface. */
const shortDays = {
  en: new Intl.DateTimeFormat("en-GB", shortDayOptions),
  fr: new Intl.DateTimeFormat("fr", shortDayOptions),
} satisfies { [locale in Locale]: Intl.DateTimeFormat };

/** "Salary and Meal vouchers", in each language of the interface. */
const lists = {
  en: new Intl.ListFormat("en", { type: "conjunction" }),
  fr: new Intl.ListFormat("fr", { type: "conjunction" }),
} satisfies { [locale in Locale]: Intl.ListFormat };

/** Rows shown before "+ N more": the skeletons have exactly as many. */
const SPENDING_ROWS = 5;
const LINES_TO_REVIEW = 3;
const GROUPS = SpendingGroup.literals;
const TO_REVIEW = "to-review";

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

const yearMonthOf = (month: string) => {
  const [year = 0, number = 1] = month.split("-").map(Number);

  return { year, month: number };
};

const monthText = (value: { year: number; month: number }) =>
  `${String(value.year)}-${String(value.month).padStart(2, "0")}`;

export const Route = createFileRoute("/_authed/")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ month: Schema.optional(Month) })),
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context: { queryClient }, deps }) => {
    const current = await queryClient.ensureQueryData(monthQueries.current());
    const month = deps.month ?? current;

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

    return { month, current };
  },
  component: Review,
});

function useLocale() {
  return Route.useRouteContext({ select: (context) => context.viewer.locale });
}

/** The monthly review (docs/wireframes, screens 1 and 11), on the made-up data of v0.1. */
function Review() {
  const messages = useMessages();
  const locale = useLocale();
  const navigate = useNavigate();
  const router = useRouter();
  const { month, current } = Route.useLoaderData();
  // Changing month keeps the month on screen until the next one has its data; then the bars and
  // amounts move to their new values.
  const shown = useDeferredValue(month);
  const linesToReview = useQuery(monthQueries.toReview(shown)).data?.count ?? 0;

  // The months a press away are loaded before the press.
  useEffect(() => {
    for (const next of [addMonths(month, -1), addMonths(month, 1)]) {
      if (next <= current) {
        void router.preloadRoute({ to: "/", search: { month: next } });
      }
    }
  }, [month, current, router]);

  return (
    <ReviewPage>
      <ReviewHeader
        title={monthNames[locale].format(dateOf(`${shown}-01`))}
        month={
          <MonthSwitcher
            value={yearMonthOf(shown)}
            latest={yearMonthOf(current)}
            onChange={(next) => void navigate({ to: "/", search: { month: monthText(next) } })}
          />
        }
        status={
          <Suspense fallback={null}>
            <ImportStatus month={shown} />
          </Suspense>
        }
        notice={messages.review.madeUp}
      />
      <DataBlock
        title={messages.review.summary.title}
        skeleton={<MonthBarSkeleton />}
        resetKey={shown}
      >
        <Summary month={shown} />
      </DataBlock>
      <ReviewGrid>
        <ReviewCell column="main">
          <DataBlock
            title={messages.review.spending.title}
            skeleton={<BreakdownSkeleton rows={SPENDING_ROWS} more />}
            resetKey={shown}
          >
            <Spending month={shown} />
          </DataBlock>
        </ReviewCell>
        <ReviewCell column="side">
          <DataBlock
            title={messages.review.movements.title}
            aside={messages.review.movements.aside}
            foldOnPhone
            skeleton={<MovementListSkeleton />}
            resetKey={shown}
          >
            <Movements month={shown} />
          </DataBlock>
          <DataBlock
            title={messages.review.investments.title}
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
              title={messages.review.toReview.title}
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
            title={messages.review.flags.title}
            foldOnPhone
            skeleton={<FlagListSkeleton />}
            resetKey={shown}
          >
            <Flags month={shown} />
          </DataBlock>
        </ReviewCell>
      </ReviewGrid>
    </ReviewPage>
  );
}

function ImportStatus({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data: imports } = useSuspenseQuery(monthQueries.imports(month));
  const { data: toReview } = useSuspenseQuery(monthQueries.toReview(month));

  return (
    <>
      <StatusPiece>
        {messages.review.imports.imported(imports.imported, imports.accounts)}
      </StatusPiece>
      {imports.partial.map((partial) => (
        <StatusPiece key={partial.account}>
          {messages.review.imports.upTo(
            partial.account,
            shortDays[locale].format(dateOf(partial.coveredTo)),
          )}
        </StatusPiece>
      ))}
      {toReview.count === 0 ? null : (
        <StatusPiece>
          <JumpLink to={TO_REVIEW}>
            {messages.review.imports.linesToReview(toReview.count)}
          </JumpLink>
        </StatusPiece>
      )}
    </>
  );
}

function Summary({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.summary(month));

  return (
    <MonthBar
      received={data.received}
      spent={data.spent}
      saved={data.setAside}
      left={data.left}
      restricted={data.restricted}
      note={lists[locale].format(data.receivedFrom)}
      comparison={
        data.averageSpent === null ? undefined : (
          <>
            {messages.review.summary.spending}{" "}
            <Delta
              value={data.spent}
              reference={data.averageSpent}
              referenceLabel={messages.review.summary.average}
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
  const messages = useMessages();
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
      <TabsList label={messages.review.spending.title}>
        {GROUPS.map((group) => (
          <Tab key={group} value={group}>
            {messages.review.spending.tabs[group]}
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
  const messages = useMessages();
  const locale = useLocale();
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
      benchmarkLabel={messages.review.summary.average}
      detail={
        row === undefined ? null : (
          <Suspense fallback={<SpendingChartSkeleton />}>
            <RowChart month={month} by={by} name={row.name} />
          </Suspense>
        )
      }
      emptyText={messages.review.spending.empty[by]}
      footnote={
        data.pending.minor > 0
          ? messages.review.spending.pending(formatMoney(data.pending, { locale, whole: true }))
          : undefined
      }
      locale={locale}
    />
  );
}

function RowChart({ month, by, name }: { month: string; by: SpendingGroup; name: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.spendingDays(month, by, name));
  const [year = 0, number = 1] = month.split("-").map(Number);

  const monthName = (offset: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, number - 1 + offset, 1)),
    );

  return (
    <SpendingChart
      days={data.days.map((day) => ({ ...day, date: dateOf(day.date) }))}
      currency={data.currency}
      label={messages.review.spending.chart(name, monthName(0), monthName(-1))}
      currentLabel={monthName(0)}
      previousLabel={monthName(-1)}
    />
  );
}

function Movements({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.movements(month));

  return (
    <Folded
      title={messages.review.movements.title}
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
        label={messages.review.movements.title}
        emptyText={messages.review.movements.empty}
        locale={locale}
      />
    </Folded>
  );
}

function Investments({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.investments(month));
  const total = data.accounts.reduce((sum, account) => sum + account.value.minor, 0);
  const currency = data.accounts[0]?.value.currency ?? "EUR";

  return (
    <Folded
      title={messages.review.investments.title}
      summary={formatMoney({ minor: total, currency }, { locale, whole: true })}
    >
      <InvestmentList
        accounts={data.accounts.map((account) => ({ id: account.account, ...account }))}
        label={messages.review.investments.title}
        emptyText={messages.review.investments.empty}
        locale={locale}
      />
    </Folded>
  );
}

function ToReview({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.toReview(month));
  const approve = useApproveLine(month);
  const [all, setAll] = useState(false);

  return (
    <Folded
      title={messages.review.toReview.title}
      summary={<Count value={data.count} locale={locale} />}
    >
      <ReviewLines
        lines={data.lines.map((line) => ({
          id: line.id,
          label: line.label,
          title: line.merchant ?? line.label,
          tags: [line.category, line.account].flatMap((tag) => (tag === null ? [] : [tag])),
          amount: line.amount,
        }))}
        approveText={messages.review.toReview.approve}
        approveLabel={(line) => messages.review.toReview.approveLine(line.label)}
        onApprove={(id) => approve.mutate(id)}
        limit={all ? undefined : LINES_TO_REVIEW}
        onMore={() => setAll(true)}
        label={messages.review.toReview.title}
        locale={locale}
      />
    </Folded>
  );
}

function Flags({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.flags(month));
  const amount = (value: Money) => formatMoney(value, { locale });

  const sentence = (flag: Flag) => {
    switch (flag.kind) {
      case "price-change": {
        return {
          id: `price-${flag.merchant}`,
          icon: flag.now.minor > flag.before.minor ? ("up" as const) : ("down" as const),
          text: messages.review.flags.priceChange(
            flag.merchant,
            amount(flag.before),
            amount(flag.now),
          ),
        };
      }

      case "not-imported": {
        return {
          id: `import-${flag.account}`,
          icon: "import" as const,
          text: messages.review.flags.notImported(
            flag.account,
            shortDays[locale].format(dateOf(flag.coveredTo)),
          ),
        };
      }
    }
  };

  return (
    <Folded
      title={messages.review.flags.title}
      summary={<Count value={data.flags.length} locale={locale} />}
    >
      <FlagList
        flags={data.flags.map(sentence)}
        label={messages.review.flags.title}
        emptyText={messages.review.flags.empty}
      />
    </Folded>
  );
}
