import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";

import { AppLink } from "@/components/app-link";
import { ChangePasswordFields, useChangePassword } from "@/components/change-password";

export const Route = createFileRoute("/_authed/change-password")({
  component: ChangePassword,
});

function ChangePassword() {
  const navigate = useNavigate();
  const router = useRouter();
  const { user } = Route.useRouteContext();

  const { refusal, busy, submit, clearRefusal } = useChangePassword(async () => {
    await router.invalidate();
    await navigate({ to: "/" });
  });

  return (
    <Screen>
      <Card
        title={m.changePasswordTitle()}
        description={
          user.mustChangePassword ? m.changePasswordRequired() : m.changePasswordDescription()
        }
      >
        <Form onSubmit={(event) => void submit(event)} onInput={clearRefusal}>
          <ChangePasswordFields refusal={refusal} />
          <Actions>
            <Button type="submit" loading={busy}>
              {m.changePasswordSubmit()}
            </Button>
            {user.mustChangePassword ? null : <AppLink to="/">{m.usersBack()}</AppLink>}
          </Actions>
        </Form>
      </Card>
    </Screen>
  );
}
