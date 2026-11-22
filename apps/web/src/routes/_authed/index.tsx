import { m } from "@gousset/i18n/messages";
import { Card } from "@gousset/ui/components/card";
import { Screen } from "@gousset/ui/components/screen";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/")({
  component: Review,
});

function Review() {
  return (
    <Screen>
      <Card title={m.reviewTitle()}>{m.reviewEmptyDescription()}</Card>
    </Screen>
  );
}
