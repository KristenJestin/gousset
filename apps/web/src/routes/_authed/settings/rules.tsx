import { m } from "@gousset/i18n/messages";
import { ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/rules")({
  component: Rules,
});

function Rules() {
  return (
    <ScreenBlock>
      <EmptyState
        icon="rules"
        title={m.rulesEmptyTitle()}
        description={m.rulesEmptyDescription()}
      />
    </ScreenBlock>
  );
}
