import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

import { MonthSwitch } from "@/components/month-switch";
import { monthSearch } from "@/lib/month";

/** The monthly review, the home: one month at a time, named in the URL (`?month=2026-10`). */
export const Route = createFileRoute("/_authed/")({
  validateSearch: monthSearch,
  component: Review,
});

function Review() {
  const { month } = Route.useSearch();
  const { currentMonth } = Route.useRouteContext();
  const navigate = Route.useNavigate();

  return (
    <Page
      title={m.reviewTitle()}
      actions={
        <MonthSwitch
          month={month ?? currentMonth}
          currentMonth={currentMonth}
          onChange={(next) => void navigate({ search: { month: next } })}
        />
      }
    >
      <ScreenBlock>
        <EmptyState
          icon="review"
          title={m.reviewEmptyTitle()}
          description={m.reviewEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
