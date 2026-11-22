import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/accounts")({
  component: Accounts,
});

function Accounts() {
  return (
    <Page title={m.accountsTitle()}>
      <ScreenBlock>
        <EmptyState
          icon="accounts"
          title={m.accountsEmptyTitle()}
          description={m.accountsEmptyDescription()}
        />
      </ScreenBlock>
    </Page>
  );
}
