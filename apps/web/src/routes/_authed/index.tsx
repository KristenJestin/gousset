import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { Actions, Screen } from "@gousset/ui/components/screen";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppLink } from "@/components/app-link";
import { useMessages } from "@/i18n/use-messages";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authed/")({
  component: Home,
});

// The app's frame and its pages come with their own issues; this page only proves the session.
function Home() {
  const messages = useMessages();
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();

  async function signOut() {
    await authClient.signOut();
    await navigate({ to: "/sign-in" });
  }

  return (
    <Screen>
      <Card title={messages.home.greeting(user.name)} description={messages.home.empty}>
        <Actions>
          {user.isAdmin ? <AppLink to="/users">{messages.home.users}</AppLink> : null}
          <AppLink to="/change-password">{messages.home.changePassword}</AppLink>
          <Button variant="secondary" onClick={() => void signOut()}>
            {messages.home.signOut}
          </Button>
        </Actions>
      </Card>
    </Screen>
  );
}
