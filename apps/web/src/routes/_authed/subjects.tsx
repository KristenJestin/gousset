import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/subjects")({
  component: Subjects,
});

function Subjects() {
  return (
    <Page title={m.subjectsTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="subjects"
          title={m.subjectsEmptyTitle()}
          description={m.subjectsEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
