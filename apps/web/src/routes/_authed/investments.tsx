import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/investments")({
  component: Investments,
});

function Investments() {
  return (
    <Page title={m.investmentsTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="investments"
          title={m.investmentsEmptyTitle()}
          description={m.investmentsEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
