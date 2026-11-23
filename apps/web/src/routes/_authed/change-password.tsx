import { m } from "@gousset/i18n/messages";
import { getLocale, locales } from "@gousset/i18n/runtime";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Schema } from "effect";

import { ChangePasswordFields, useChangePassword } from "@/components/change-password";
import { AUTHORIZE_PATH } from "@/lib/authorization";

/**
 * The change of a temporary password, alone on its page before the app opens. Anyone else
 * changes theirs in the settings (#105), where this address leads them.
 */
export const Route = createFileRoute("/_authed/change-password")({
  // An MCP client's authorization the sign-in was for, resumed once the password is changed.
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ resume: Schema.optional(Schema.String) }),
  ),
  beforeLoad: ({ context }) => {
    if (!context.user.mustChangePassword) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/settings/account" });
    }
  },
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
  const { user } = Route.useRouteContext();
  const { resume } = Route.useSearch();

  const { refusal, busy, submit, clearRefusal } = useChangePassword(async () => {
    // Back to the authorization server, which goes on to the consent: a page of the server, not a
    // route of the app, so the browser loads it.
    if (resume !== undefined) {
      window.location.assign(`${AUTHORIZE_PATH}?${resume}`);

      return;
    }

    // The root reads the viewer again on the way: the app opens. No invalidation first, which
    // would run this page's own guard, now false, and step through the settings. A one-time
    // step: Back does not return to it.
    await navigate({ to: "/", replace: true });
  });

  return (
    <Screen>
      <Card
        title={m.changePasswordTitle()}
        description={whyChange(user.passwordResetOn, user.passwordResetFromServer)}
      >
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
