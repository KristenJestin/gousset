import { m } from "@gousset/i18n/messages";
import { getLocale, locales } from "@gousset/i18n/runtime";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";
import type { FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { passwordRules, refusalMessage, refusalOf } from "@/i18n/messages";
import type { Refusal } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { AUTHORIZE_PATH } from "@/lib/authorization";
import { emptyPasswords, formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

export const Route = createFileRoute("/_authed/change-password")({
  // An MCP client's authorization the sign-in was for, resumed once the password is changed.
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ resume: Schema.optional(Schema.String) }),
  ),
  component: ChangePassword,
});

/**
 * A calendar day in words, one formatter per language, built once. In UTC, as the day is written:
 * the same text on the server and in the browser.
 */
const dayFormats = new Map<string, Intl.DateTimeFormat>();

for (const locale of locales) {
  dayFormats.set(locale, new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }));
}

const englishDays = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

/** A calendar day (`YYYY-MM-DD`) in words, in the page's language. */
function dayInWords(day: string) {
  return (dayFormats.get(getLocale()) ?? englishDays).format(new Date(`${day}T00:00:00Z`));
}

/**
 * Why the password must change: temporary, and reset on that day if so, by the administrator or
 * from the server (the administrator's own, recovered).
 */
function whyChange(passwordResetOn: string | null, fromServer: boolean) {
  if (passwordResetOn === null) {
    return m.changePasswordRequired();
  }

  const date = dayInWords(passwordResetOn);

  const reset = fromServer
    ? m.changePasswordRecoveredOn({ date })
    : m.changePasswordResetOn({ date });

  return `${reset} ${m.changePasswordRequired()}`;
}

function ChangePassword() {
  const navigate = useNavigate();
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const { resume } = Route.useSearch();
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

    // Back to the authorization server, which goes on to the consent: a page of the server, not a
    // route of the app, so the browser loads it.
    if (resume !== undefined) {
      window.location.assign(`${AUTHORIZE_PATH}?${resume}`);

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
          user.mustChangePassword
            ? whyChange(user.passwordResetOn, user.passwordResetFromServer)
            : m.changePasswordDescription()
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
