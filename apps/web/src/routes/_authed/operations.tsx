import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

import { MonthSwitch } from "@/components/month-switch";
import { monthSearch } from "@/lib/month";

/** Every operation of a month, named in the URL (`?month=2026-10`). */
export const Route = createFileRoute("/_authed/operations")({
  validateSearch: monthSearch,
  component: Operations,
});

function Operations() {
  const { month } = Route.useSearch();
  const { currentMonth } = Route.useRouteContext();
  const navigate = Route.useNavigate();

  return (
    <Page
      title={m.operationsTitle()}
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
          icon="operations"
          title={m.operationsEmptyTitle()}
          description={m.operationsEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
