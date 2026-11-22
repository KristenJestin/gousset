import { addMonths, Month } from "@gousset/core/values";
import { Amount } from "@gousset/ui/components/amount";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import {
  FigureList,
  FigureListSkeleton,
  FigureMore,
  FigureRow,
} from "@gousset/ui/components/data-block";
import { Actions, Screen } from "@gousset/ui/components/screen";
import { noop, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";
import { useDeferredValue } from "react";

import { AppLink } from "@/components/app-link";
import { DataBlock } from "@/components/data-block";
import type { Locale } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { authClient } from "@/lib/auth-client";
import { loadBlocks } from "@/lib/load-blocks";
import { useApproveLine } from "@/queries/approve-line";
import { monthQueries } from "@/queries/month";

const monthNameOptions = { month: "long", year: "numeric", timeZone: "UTC" } as const;

/** "October 2026", in each language of the interface. */
const monthNames = {
  en: new Intl.DateTimeFormat("en", monthNameOptions),
  fr: new Intl.DateTimeFormat("fr", monthNameOptions),
} satisfies { [locale in Locale]: Intl.DateTimeFormat };

/** Rows shown before "+ N more": the skeletons have exactly as many. */
const SPENDING_ROWS = 5;
const LINES_TO_REVIEW = 3;

export const Route = createFileRoute("/_authed/")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ month: Schema.optional(Month) })),
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
  component: Home,
});

// The app's frame comes with #8 and the monthly review's look with #10: this page shows how a page
// loads its data, on the made-up month.
function Home() {
  const messages = useMessages();
  const navigate = useNavigate();
  const { user, viewer } = Route.useRouteContext();
  const { month } = Route.useLoaderData();
  // Changing month keeps the month on screen until the next one has its data; the header and its
  // links follow the month shown, so that they never disagree.
  const shown = useDeferredValue(month);

  const monthName = monthNames[viewer.locale].format(new Date(`${shown}-01T00:00:00Z`));

  async function signOut() {
    await authClient.signOut();
    await navigate({ to: "/sign-in" });
  }

  return (
    <Screen>
      <Card title={messages.home.greeting(user.name)} description={messages.review.madeUp}>
        <Actions>
          {user.isAdmin ? <AppLink to="/users">{messages.home.users}</AppLink> : null}
          <AppLink to="/settings">{messages.home.settings}</AppLink>
          <AppLink to="/change-password">{messages.home.changePassword}</AppLink>
          <Button variant="secondary" onClick={() => void signOut()}>
            {messages.home.signOut}
          </Button>
        </Actions>
        <Actions>
          <AppLink to="/" search={{ month: addMonths(shown, -1) }}>
            {messages.review.previousMonth}
          </AppLink>
          <span>{monthName}</span>
          <AppLink to="/" search={{ month: addMonths(shown, 1) }}>
            {messages.review.nextMonth}
          </AppLink>
        </Actions>
      </Card>
      <DataBlock
        title={messages.review.summary.title}
        skeleton={<FigureListSkeleton rows={4} />}
        resetKey={shown}
      >
        <Summary month={shown} />
      </DataBlock>
      <DataBlock
        title={messages.review.spending.title}
        skeleton={<FigureListSkeleton rows={SPENDING_ROWS} more />}
        resetKey={shown}
      >
        <Spending month={shown} />
      </DataBlock>
      <DataBlock
        title={messages.review.toReview.title}
        skeleton={<FigureListSkeleton rows={LINES_TO_REVIEW} more />}
        resetKey={shown}
      >
        <ToReview month={shown} />
      </DataBlock>
    </Screen>
  );
}

function useLocale() {
  return Route.useRouteContext({ select: (context) => context.viewer.locale });
}

function Summary({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.summary(month));

  const figures = [
    { label: messages.review.summary.received, amount: data.received },
    { label: messages.review.summary.spent, amount: data.spent },
    { label: messages.review.summary.setAside, amount: data.setAside },
    { label: messages.review.summary.left, amount: data.left },
  ];

  return (
    <FigureList label={messages.review.summary.title}>
      {figures.map(({ label, amount }) => (
        <FigureRow
          key={label}
          label={label}
          figure={<Amount value={amount} locale={locale} size="sm" />}
        />
      ))}
    </FigureList>
  );
}

function Spending({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.spending(month, "category"));
  const hidden = data.rows.length - SPENDING_ROWS;

  return (
    <FigureList label={messages.review.spending.title}>
      {data.rows.slice(0, SPENDING_ROWS).map((row) => (
        <FigureRow
          key={row.name}
          label={row.name}
          figure={<Amount value={row.amount} locale={locale} size="sm" />}
        />
      ))}
      {hidden > 0 ? <FigureMore>{messages.review.spending.more(hidden)}</FigureMore> : null}
    </FigureList>
  );
}

function ToReview({ month }: { month: string }) {
  const messages = useMessages();
  const locale = useLocale();
  const { data } = useSuspenseQuery(monthQueries.toReview(month));
  const approve = useApproveLine(month);
  const hidden = data.count - LINES_TO_REVIEW;

  if (data.count === 0) {
    return (
      <FigureList label={messages.review.toReview.title}>
        <FigureMore>{messages.review.toReview.none}</FigureMore>
      </FigureList>
    );
  }

  return (
    <FigureList label={messages.review.toReview.title}>
      {data.lines.slice(0, LINES_TO_REVIEW).map((line) => (
        <FigureRow
          key={line.id}
          label={line.label}
          detail={[line.merchant, line.category].filter((part) => part !== null).join(" · ")}
          figure={<Amount value={line.amount} locale={locale} size="sm" />}
          action={
            <Button
              variant="secondary"
              aria-label={messages.review.toReview.approveLine(line.label)}
              onClick={() => approve.mutate(line.id)}
            >
              {messages.review.toReview.approve}
            </Button>
          }
        />
      ))}
      {hidden > 0 ? <FigureMore>{messages.review.toReview.more(hidden)}</FigureMore> : null}
    </FigureList>
  );
}
