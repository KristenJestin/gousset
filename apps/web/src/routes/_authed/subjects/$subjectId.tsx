import type { Money, SubjectDetail } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Amount } from "@gousset/ui/components/amount";
import { Breakdown, BreakdownSkeleton } from "@gousset/ui/components/breakdown";
import { Button } from "@gousset/ui/components/button";
import {
  FigureList,
  FigureListSkeleton,
  FigureMore,
  FigureRow,
} from "@gousset/ui/components/data-block";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { Select } from "@gousset/ui/components/select";
import { SubjectFigures, SubjectFiguresSkeleton } from "@gousset/ui/components/subject-figures";
import { SubjectMerchants } from "@gousset/ui/components/subject-merchants";
import {
  PaybackCandidates,
  SubjectPayback,
  SubjectPaybackSkeleton,
} from "@gousset/ui/components/subject-payback";
import type { PaybackLineView } from "@gousset/ui/components/subject-payback";
import {
  SubjectProposals,
  SubjectProposalsSkeleton,
} from "@gousset/ui/components/subject-proposals";
import { SubjectHeading } from "@gousset/ui/components/subject-tree";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { formatMoney } from "@gousset/ui/lib/money";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { useDeferredValue, useState } from "react";

import { AppLink } from "@/components/app-link";
import { DataBlock } from "@/components/data-block";
import { SubjectSheet } from "@/components/subject-sheet";
import {
  SubjectPeriod,
  attachSubjectExpenses,
  declineSubjectProposals,
  setSubjectPayback,
} from "@/functions/subjects";
import { paybackRefusalMessage, subjectRefusalMessage } from "@/i18n/messages";
import { dayRange, shortDay, shortDays } from "@/lib/account-day";
import { categoryPath } from "@/lib/categories";
import { invalidatePaybacks, invalidateSubjects, subjectQueries } from "@/queries/subjects";

/**
 * A subject's address: the period its page reads, a year (`?period=2025`) or all time
 * (`?period=all`); the current year when it names none, or one that cannot be read.
 */
const SubjectSearch = Schema.Struct({
  period: Schema.optional(
    Schema.UndefinedOr(SubjectPeriod).pipe(
      Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))),
    ),
  ),
});

/** The period a page reads: the address's, else the current year. */
const periodOf = (asked: number | "all" | undefined, currentMonth: string) =>
  asked ?? Number(currentMonth.slice(0, 4));

export const Route = createFileRoute("/_authed/subjects/$subjectId")({
  validateSearch: Schema.toStandardSchemaV1(SubjectSearch),
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: async ({ context: { queryClient, currentMonth }, params, deps }) => {
    const detail = await queryClient.ensureQueryData(
      subjectQueries.detail(params.subjectId, periodOf(deps.period, currentMonth)),
    );

    if (!detail.ok) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
      throw notFound();
    }
  },
  notFoundComponent: SubjectNotFound,
  component: SubjectPage,
});

function SubjectNotFound() {
  return (
    <Page title={m.subjectsNotFoundTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="subjects"
          title={m.subjectsNotFoundTitle()}
          description={m.subjectsNotFoundDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}

/** The page, unwrapped: the loader already turned a refusal into "not found" before this runs. */
function useSubject(subjectId: string, period: number | "all"): SubjectDetail {
  const { data } = useSuspenseQuery(subjectQueries.detail(subjectId, period));

  if (!data.ok) {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
    throw notFound();
  }

  return data.subject;
}

const plurals = { en: new Intl.PluralRules("en"), fr: new Intl.PluralRules("fr") };

const isOne = (count: number) => plurals[getLocale()].select(count) === "one";

/** Amounts in other currencies, written and joined: "CHF 180 and $20". */
function amountsOf(amounts: ReadonlyArray<Money>, locale: string): string {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(
    amounts.map((amount) => formatMoney(amount, { locale, whole: true })),
  );
}

/** Its dates, worded: "3–17 Jul. 2028", or "from 3 Jul." while it goes on. */
function datesOf(subject: Pick<SubjectDetail, "startsOn" | "endsOn">, locale: string) {
  if (subject.startsOn === null) {
    return null;
  }

  return subject.endsOn === null
    ? m.subjectsFromDay({ day: shortDay(subject.startsOn, locale) })
    : dayRange(subject.startsOn, subject.endsOn, locale);
}

/**
 * The years a page may read: from its first expense's (or its start's) to today's, the latest
 * first.
 */
function yearsOf(
  subject: SubjectDetail,
  allTime: SubjectDetail | undefined,
  shown: number | "all",
): ReadonlyArray<number> {
  const today = Number(subject.today.slice(0, 4));

  const known = [
    today,
    ...(shown === "all" ? [] : [shown]),
    ...[allTime?.months[0]?.month, subject.startsOn].flatMap((day) =>
      day === undefined || day === null ? [] : [Number(day.slice(0, 4))],
    ),
  ].filter((year) => year <= today);

  const first = Math.min(...known);

  return Array.from({ length: today - first + 1 }, (_, index) => today - index);
}

/**
 * A subject's page (#37; docs/wireframes, screen 5): its figures for a year or all time, the
 * expenses its period proposes for a dated one (never attached unasked), its cost by category, the
 * merchants that attach it, its accounts, what is inside it, and its latest expenses, leading to
 * the operations. "Edit" opens its sheet. Changing the period keeps the page on screen until the
 * next one has its data; then the bars and amounts move to their new values.
 */
function SubjectPage() {
  const { subjectId } = Route.useParams();
  const search = Route.useSearch();
  const { currentMonth, user } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const locale = usePageLanguage();
  const period = useDeferredValue(periodOf(search.period, currentMonth));
  const subject = useSubject(subjectId, period);
  const { data: list } = useSuspenseQuery(subjectQueries.list());
  const allTime = useQuery(subjectQueries.detail(subjectId, "all")).data;
  // A new sheet each time it opens; the last one stays drawn while it closes.
  const [sheet, setSheet] = useState({ key: 0, open: false });
  const resetKey = `${subjectId}-${String(period)}`;
  const hasValue = subject.value !== null || subject.loan !== null;
  const dates = datesOf(subject, locale);

  const tags = [
    ...(hasValue ? [m.subjectsHasValue()] : []),
    ...(dates === null ? [] : [dates]),
    ...(subject.payback === null ? [] : [m.subjectsPaidBack()]),
    ...(subject.archived ? [m.uiSubjectsArchived()] : []),
  ];

  const years = yearsOf(subject, allTime?.ok === true ? allTime.subject : undefined, period);

  return (
    <>
      <SubjectHeading
        name={subject.name}
        tags={tags}
        actions={
          <>
            <div className="w-40">
              <Select
                label={m.subjectsPeriod()}
                hideLabel
                size="sm"
                items={[
                  ...years.map((year) => ({ value: String(year), label: String(year) })),
                  { value: "all", label: m.subjectsAllTime() },
                ]}
                value={String(period)}
                onValueChange={(value) => {
                  if (value !== null) {
                    void navigate({
                      search: { period: value === "all" ? "all" : Number(value) },
                      replace: true,
                    });
                  }
                }}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon="edit"
              onClick={() => setSheet({ key: sheet.key + 1, open: true })}
            >
              {m.subjectsEdit()}
            </Button>
          </>
        }
      />
      <DataBlock
        title={m.subjectsBlockFigures()}
        skeleton={<SubjectFiguresSkeleton asset={hasValue} />}
        resetKey={resetKey}
      >
        <Figures subjectId={subjectId} period={period} />
      </DataBlock>
      {subject.payback === null ? null : (
        <DataBlock
          title={m.subjectsBlockPayback()}
          skeleton={<SubjectPaybackSkeleton rows={subject.payback.lines.length} />}
          resetKey={subjectId}
        >
          <Payback subjectId={subjectId} period={period} />
        </DataBlock>
      )}
      {subject.proposals === null ? null : (
        <DataBlock
          title={m.subjectsBlockProposals()}
          skeleton={<SubjectProposalsSkeleton />}
          resetKey={subjectId}
        >
          <Proposals subjectId={subjectId} period={period} />
        </DataBlock>
      )}
      <DataBlock
        title={m.subjectsBlockCategories()}
        skeleton={<BreakdownSkeleton rows={Math.max(1, subject.categories.length)} />}
        resetKey={resetKey}
      >
        <Categories subjectId={subjectId} period={period} />
      </DataBlock>
      <DataBlock
        title={m.subjectsBlockMerchants()}
        skeleton={<FigureListSkeleton rows={1} />}
        resetKey={subjectId}
      >
        <Merchants subjectId={subjectId} period={period} />
      </DataBlock>
      <DataBlock
        title={m.subjectsBlockAccounts()}
        skeleton={<FigureListSkeleton rows={Math.max(1, subject.accounts.length)} />}
        resetKey={subjectId}
      >
        <Accounts subjectId={subjectId} period={period} />
      </DataBlock>
      {subject.children.length === 0 ? null : (
        <DataBlock
          title={m.subjectsBlockChildren()}
          skeleton={<FigureListSkeleton rows={subject.children.length} />}
          resetKey={resetKey}
        >
          <Children subjectId={subjectId} period={period} />
        </DataBlock>
      )}
      <DataBlock
        title={m.subjectsBlockExpenses()}
        aside={(isOne(subject.expenses.count) ? m.subjectsExpensesOne : m.subjectsExpensesOther)({
          count: subject.expenses.count,
        })}
        skeleton={<FigureListSkeleton rows={subject.expenses.latest.length} more />}
        resetKey={resetKey}
      >
        <Expenses subjectId={subjectId} period={period} />
      </DataBlock>
      <SubjectSheet
        key={sheet.key}
        open={sheet.open}
        onOpenChange={(open) => setSheet({ ...sheet, open })}
        subject={subject}
        subjects={list.subjects}
        currency={user.currency}
      />
    </>
  );
}

type BlockProps = { subjectId: string; period: number | "all" };

function Figures({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();
  const months = subject.months.length;
  const hasValue = subject.value !== null || subject.loan !== null;

  return (
    <SubjectFigures
      costLabel={
        period === "all" ? m.subjectsCostAllTime() : m.subjectsCostIn({ year: String(period) })
      }
      cost={subject.total}
      elsewhere={subject.elsewhere}
      perMonth={
        months === 0
          ? null
          : { minor: Math.round(subject.total.minor / months), currency: subject.currency }
      }
      asset={
        hasValue
          ? {
              value: subject.value,
              loan:
                subject.loan === null
                  ? null
                  : { name: subject.loan.name, balance: subject.loan.balance },
            }
          : undefined
      }
      locale={locale}
    />
  );
}

/** A payback line, or one that may be, as the payback block and its sheet show it. */
function paybackLineOf(
  line: NonNullable<SubjectDetail["payback"]>["lines"][number],
  day: (iso: string) => string,
): PaybackLineView {
  return {
    id: line.lineId,
    day: day(line.bookedOn),
    label: line.label,
    account: line.account.name,
    amount: line.amount,
  };
}

/** What a call answers once it failed outright: a refusal the page can say. */
const failedPayback = { ok: false as const, code: "UNKNOWN" };

/**
 * A paid-back subject's block (#217): where it stands, what it cost and what came back, its payback
 * lines, each to detach, and the lines that may pay it back, in a sheet, each attached on the
 * user's yes. A refusal is said in a toast for a detachment, in the sheet for an attachment.
 */
function Payback({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const day = shortDays(locale);
  const [error, setError] = useState<string>();

  if (subject.payback === null) {
    return null;
  }

  const { payback } = subject;

  /** Attaches or detaches one line; false when refused, so that its row comes back. */
  async function settle(lineId: string, remove: boolean): Promise<boolean> {
    const answer = await setSubjectPayback({ data: { subjectId, lineIds: [lineId], remove } }).then(
      (done) => done,
      () => failedPayback,
    );

    if (!answer.ok) {
      const message = paybackRefusalMessage(answer.code);

      if (remove) {
        notify.failed({ description: message });
      } else {
        setError(message);
      }

      return false;
    }

    setError(undefined);
    notify.saved({
      description: remove ? m.subjectsPaybackDetached() : m.subjectsPaybackAttached(),
    });
    await invalidatePaybacks(queryClient);

    return true;
  }

  return (
    <SubjectPayback
      from={payback.from}
      state={payback.state}
      askedOn={payback.askedOn === null ? undefined : shortDay(payback.askedOn, locale)}
      spent={payback.spent}
      paidBack={payback.paidBack}
      difference={payback.difference}
      lines={payback.lines.map((line) => paybackLineOf(line, day))}
      onDetach={(lineId) => settle(lineId, true)}
      find={
        subject.archived ? undefined : (
          <PaybackCandidates
            from={payback.from}
            candidates={payback.candidates.map((line) => paybackLineOf(line, day))}
            onAttach={(lineId) => settle(lineId, false)}
            error={error}
            locale={locale}
          />
        )
      }
      locale={locale}
    />
  );
}

function Proposals({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  const day = shortDays(locale);

  if (subject.proposals === null) {
    return null;
  }

  /** Attaches or declines, said in a toast; false when refused, so that the rows come back. */
  async function settle(
    call: () => Promise<{ ok: true } | { ok: false; code: string }>,
    said: (count: number) => string,
    count: number,
  ): Promise<boolean> {
    const answer = await call().then(
      (done) => done,
      () => ({ ok: false as const, code: "UNKNOWN" }),
    );

    if (!answer.ok) {
      notify.failed({ description: subjectRefusalMessage(answer.code) });

      return false;
    }

    notify.saved({ description: said(count) });
    await invalidateSubjects(queryClient);

    return true;
  }

  return (
    <SubjectProposals
      label={m.subjectsBlockProposals()}
      proposals={subject.proposals.expenses.map((expense) => ({
        id: expense.entryId,
        day: day(expense.happenedOn),
        title: expense.merchant ?? expense.label,
        category: categoryPath(expense.category),
        amount: expense.net,
      }))}
      more={subject.proposals.more}
      onAttach={(ids) =>
        settle(
          () => attachSubjectExpenses({ data: { subjectId, entryIds: [...ids] } }),
          (count) => (isOne(count) ? m.subjectsAttachedOne : m.subjectsAttachedOther)({ count }),
          ids.length,
        )
      }
      onDecline={(ids) =>
        settle(
          () => declineSubjectProposals({ data: { subjectId, entryIds: [...ids] } }),
          (count) => (isOne(count) ? m.subjectsDeclinedOne : m.subjectsDeclinedOther)({ count }),
          ids.length,
        )
      }
      locale={locale}
    />
  );
}

function Categories({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();

  return (
    <Breakdown
      rows={subject.categories.map((each) => ({
        id: each.category.id,
        name: categoryPath(each.category),
        amount: each.spent,
      }))}
      emptyText={m.subjectsNoExpense()}
      locale={locale}
    />
  );
}

function Merchants({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();

  return (
    <SubjectMerchants
      merchants={subject.merchants.map((merchant) => merchant.name)}
      otherRules={subject.otherRules}
      locale={locale}
    />
  );
}

function Accounts({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();

  if (subject.accounts.length === 0) {
    return <EmptyState size="compact" title={m.subjectsAccountsNone()} />;
  }

  return (
    <FigureList label={m.subjectsBlockAccounts()}>
      {subject.accounts.map((account) => (
        <FigureRow
          key={account.id}
          label={account.name}
          detail={account.institution ?? undefined}
          figure={<Amount value={account.balance} size="sm" locale={locale} />}
        />
      ))}
    </FigureList>
  );
}

function Children({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();

  return (
    <FigureList label={m.subjectsBlockChildren()}>
      {subject.children.map((child) => {
        const detail = [
          ...(child.archived ? [m.uiSubjectsArchived()] : []),
          ...(child.elsewhere.length === 0 ? [] : [amountsOf(child.elsewhere, locale)]),
        ].join(" · ");

        return (
          <FigureRow
            key={child.id}
            label={child.name}
            detail={detail === "" ? undefined : detail}
            figure={<Amount value={child.total} size="sm" whole locale={locale} />}
          />
        );
      })}
    </FigureList>
  );
}

function Expenses({ subjectId, period }: BlockProps) {
  const subject = useSubject(subjectId, period);
  const locale = usePageLanguage();
  const day = shortDays(locale);
  const { from } = subject.period;

  return (
    <FigureList label={m.subjectsBlockExpenses()}>
      {subject.expenses.latest.length === 0 ? (
        <FigureMore>{m.subjectsNoExpense()}</FigureMore>
      ) : (
        subject.expenses.latest.map((expense) => (
          <FigureRow
            key={expense.entryId}
            label={expense.merchant ?? expense.label}
            detail={`${day(expense.happenedOn)} · ${categoryPath(expense.category)}`}
            figure={<Amount value={expense.net} size="sm" roll={false} locale={locale} />}
          />
        ))
      )}
      <FigureMore>
        <AppLink
          to="/operations"
          search={
            from === null
              ? { subject: subjectId }
              : { subject: subjectId, from, to: subject.period.to }
          }
        >
          {m.subjectsSeeAll()}
        </AppLink>
      </FigureMore>
    </FigureList>
  );
}
