import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Amount } from "@gousset/ui/components/amount";
import { Page } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import {
  FigureList,
  FigureListSkeleton,
  FigureMore,
  FigureRow,
} from "@gousset/ui/components/data-block";
import { noop, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue } from "react";

import { DataBlock } from "@/components/data-block";
import { MonthSwitch } from "@/components/month-switch";
import { loadBlocks } from "@/lib/load-blocks";
import { monthSearch } from "@/lib/month";
import { useApproveLine } from "@/queries/approve-line";
import { monthQueries } from "@/queries/month";

/** Rows shown before "+ N more": the skeletons have exactly as many. */
const SPENDING_ROWS = 5;
const LINES_TO_REVIEW = 3;

/** The monthly review, the home: one month at a time, named in the URL (`?month=2026-10`). */
export const Route = createFileRoute("/_authed/")({
  validateSearch: monthSearch,
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context: { queryClient }, deps }) => {
    const month = deps.month ?? (await queryClient.ensureQueryData(monthQueries.current()));

    await loadBlocks([
      queryClient.ensureQueryData(monthQueries.summary(month)).then(noop),
      queryClient.ensureQueryData(monthQueries.spending(month, "category")).then(noop),
      queryClient.ensureQueryData(monthQueries.toReview(month)).then(noop),
    ]);

    return { month };
  },
  component: Review,
});

// The monthly review's look comes with #10: this page shows how a page loads its data, on the
// made-up month, in the app's frame.
function Review() {
  const { currentMonth } = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const { month } = Route.useLoaderData();
  // Changing month keeps the month on screen until the next one has its data; the switcher
  // follows the month shown, so that they never disagree.
  const shown = useDeferredValue(month);

  return (
    <Page
      title={m.reviewTitle()}
      description={m.reviewMadeUp()}
      actions={
        <MonthSwitch
          month={shown}
          currentMonth={currentMonth}
          onChange={(next) => void navigate({ search: { month: next } })}
        />
      }
    >
      <DataBlock
        title={m.reviewSummaryTitle()}
        skeleton={<FigureListSkeleton rows={4} />}
        resetKey={shown}
      >
        <Summary month={shown} />
      </DataBlock>
      <DataBlock
        title={m.reviewSpendingTitle()}
        skeleton={<FigureListSkeleton rows={SPENDING_ROWS} more />}
        resetKey={shown}
      >
        <Spending month={shown} />
      </DataBlock>
      <DataBlock
        title={m.reviewToReviewTitle()}
        skeleton={<FigureListSkeleton rows={LINES_TO_REVIEW} more />}
        resetKey={shown}
      >
        <ToReview month={shown} />
      </DataBlock>
    </Page>
  );
}

function Summary({ month }: { month: string }) {
  const { data } = useSuspenseQuery(monthQueries.summary(month));

  const figures = [
    { label: m.reviewReceived(), amount: data.received },
    { label: m.reviewSpent(), amount: data.spent },
    { label: m.reviewSetAside(), amount: data.setAside },
    { label: m.reviewLeft(), amount: data.left },
  ];

  return (
    <FigureList label={m.reviewSummaryTitle()}>
      {figures.map(({ label, amount }) => (
        <FigureRow
          key={label}
          label={label}
          figure={<Amount value={amount} locale={getLocale()} size="sm" />}
        />
      ))}
    </FigureList>
  );
}

function Spending({ month }: { month: string }) {
  const { data } = useSuspenseQuery(monthQueries.spending(month, "category"));
  const hidden = data.rows.length - SPENDING_ROWS;

  return (
    <FigureList label={m.reviewSpendingTitle()}>
      {data.rows.slice(0, SPENDING_ROWS).map((row) => (
        <FigureRow
          key={row.name}
          label={row.name}
          figure={<Amount value={row.amount} locale={getLocale()} size="sm" />}
        />
      ))}
      {hidden > 0 ? (
        <FigureMore>
          {hidden === 1
            ? m.reviewMoreCategoriesOne({ count: hidden })
            : m.reviewMoreCategoriesOther({ count: hidden })}
        </FigureMore>
      ) : null}
    </FigureList>
  );
}

function ToReview({ month }: { month: string }) {
  const { data } = useSuspenseQuery(monthQueries.toReview(month));
  const approve = useApproveLine(month);
  const hidden = data.count - LINES_TO_REVIEW;

  if (data.count === 0) {
    return (
      <FigureList label={m.reviewToReviewTitle()}>
        <FigureMore>{m.reviewNothingToReview()}</FigureMore>
      </FigureList>
    );
  }

  return (
    <FigureList label={m.reviewToReviewTitle()}>
      {data.lines.slice(0, LINES_TO_REVIEW).map((line) => (
        <FigureRow
          key={line.id}
          label={line.label}
          detail={[line.merchant, line.category].filter((part) => part !== null).join(" · ")}
          figure={<Amount value={line.amount} locale={getLocale()} size="sm" />}
          action={
            <Button
              variant="secondary"
              aria-label={m.reviewApproveLine({ label: line.label })}
              onClick={() => approve.mutate(line.id)}
            >
              {m.reviewApprove()}
            </Button>
          }
        />
      ))}
      {hidden > 0 ? <FigureMore>{m.reviewMoreLines({ count: hidden })}</FigureMore> : null}
    </FigureList>
  );
}
