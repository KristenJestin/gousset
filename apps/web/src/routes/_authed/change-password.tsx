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
import { passwordRules, refusalMessage, refusalOf } from "@/i18n/messages";
import type { Refusal } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { emptyPasswords, formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

export const Route = createFileRoute("/_authed/change-password")({
  component: ChangePassword,
});

function ChangePassword() {
  const navigate = useNavigate();
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const [refusal, setRefusal] = useState<Refusal>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const { error: refused } = await whileBusy(setBusy, () =>
      authClient.changePassword({
        currentPassword: formText(form, "currentPassword"),
        newPassword: formText(form, "newPassword"),
        revokeOtherSessions: true,
      }),
    );

    if (refused) {
      setRefusal(refusalOf(refused.code));
      emptyPasswords(formElement, ["currentPassword", "newPassword"]);

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
        <Form onSubmit={(event) => void submit(event)} onInput={() => setRefusal(undefined)}>
          <TextField
            label={m.fieldCurrentPassword()}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            error={refusalMessage(refusal, "currentPassword")}
          />
          <TextField
            label={m.fieldNewPassword()}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            description={passwordRules()}
            error={refusalMessage(refusal, "password")}
          />
          <FormMessage message={refusalMessage(refusal, undefined)} />
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
