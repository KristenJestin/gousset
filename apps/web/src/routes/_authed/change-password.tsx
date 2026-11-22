import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { errorMessage } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

export const Route = createFileRoute("/_authed/change-password")({
  component: ChangePassword,
});

function ChangePassword() {
  const navigate = useNavigate();
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const { error: refusal } = await whileBusy(setBusy, () =>
      authClient.changePassword({
        currentPassword: formText(form, "currentPassword"),
        newPassword: formText(form, "newPassword"),
        revokeOtherSessions: true,
      }),
    );

    if (refusal) {
      setError(errorMessage(refusal.code));

      return;
    }

    await router.invalidate();
    await navigate({ to: "/" });
  }

  return (
    <Screen>
      <Card
        title={m.changePasswordTitle()}
        description={
          user.mustChangePassword ? m.changePasswordRequired() : m.changePasswordDescription()
        }
      >
        <Form onSubmit={(event) => void submit(event)} onInput={() => setError(undefined)}>
          <TextField
            label={m.fieldCurrentPassword()}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          <TextField
            label={m.fieldNewPassword()}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <FormMessage message={error} />
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
