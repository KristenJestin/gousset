import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import { ChangePasswordFields, useChangePassword } from "@/components/change-password";

/**
 * The change of a temporary password, alone on its page before the app opens. Anyone else
 * changes theirs in the settings (#105), where this address leads them.
 */
export const Route = createFileRoute("/_authed/change-password")({
  beforeLoad: ({ context }) => {
    if (!context.user.mustChangePassword) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/settings/account" });
    }
  },
  component: ChangePassword,
});

function ChangePassword() {
  const navigate = useNavigate();

  // The root reads the viewer again on the way: the app opens. No invalidation first, which would
  // run this page's own guard, now false, and step through the settings. A one-time step: Back
  // does not return to it.
  const { refusal, busy, submit, clearRefusal } = useChangePassword(() =>
    navigate({ to: "/", replace: true }),
  );

  return (
    <Screen>
      <Card title={m.changePasswordTitle()} description={m.changePasswordRequired()}>
        <Form onSubmit={(event) => void submit(event)} onInput={clearRefusal}>
          <ChangePasswordFields refusal={refusal} />
          <Actions>
            <Button type="submit" loading={busy}>
              {m.changePasswordSubmit()}
            </Button>
          </Actions>
        </Form>
      </Card>
    </Screen>
  );
}
