import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/import")({
  component: Import,
});

function Import() {
  return (
    <Page title={m.importTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="import"
          title={m.importEmptyTitle()}
          description={m.importEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
