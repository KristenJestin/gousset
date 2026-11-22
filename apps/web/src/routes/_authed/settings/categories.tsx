import { m } from "@gousset/i18n/messages";
import { ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/categories")({
  component: Categories,
});

function Categories() {
  return (
    <ScreenBlock>
      <EmptyState
        icon="other"
        title={m.categoriesEmptyTitle()}
        description={m.categoriesEmptyDescription()}
      />
    </ScreenBlock>
  );
}
