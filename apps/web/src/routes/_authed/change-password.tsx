import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
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

/** A calendar day (`YYYY-MM-DD`) in words, the same on the server and in the browser. */
function dayInWords(day: string) {
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** Why the password must change: temporary, and reset by the administrator on that day if so. */
function whyChange(passwordResetOn: string | null) {
  return passwordResetOn === null
    ? m.changePasswordRequired()
    : `${m.changePasswordResetOn({ date: dayInWords(passwordResetOn) })} ${m.changePasswordRequired()}`;
}

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
          user.mustChangePassword ? whyChange(user.passwordResetOn) : m.changePasswordDescription()
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
