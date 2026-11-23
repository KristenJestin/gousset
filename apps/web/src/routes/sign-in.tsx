import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { refusalMessage, refusalOf } from "@/i18n/messages";
import type { Refusal } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { authorizationToResume } from "@/lib/authorization";
import { emptyPasswords, formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: ({ context }) => {
    if (!context.viewer.hasUsers) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/setup" });
    }

    if (context.viewer.user) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const { searchStr } = useLocation();
  const [refusal, setRefusal] = useState<Refusal>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const { data, error: refused } = await whileBusy(setBusy, () =>
      authClient.signIn.email({
        email: formText(form, "email"),
        password: formText(form, "password"),
      }),
    );

    // Signed in on a temporary password for an MCP client's authorization: the session opens
    // nothing but the change, so the resumed authorization is refused. The change comes first, and
    // the authorization resumes after it (#70).
    if (refused?.code === "PASSWORD_CHANGE_REQUIRED") {
      const resume = authorizationToResume(searchStr);

      // A page of its own, loaded with the session the sign-in just set.
      window.location.assign(
        resume === undefined
          ? "/change-password"
          : `/change-password?${new URLSearchParams({ resume }).toString()}`,
      );

      return;
    }

    if (refused) {
      setRefusal(refusalOf(refused.code));
      emptyPasswords(formElement, ["password"]);

      return;
    }

    setRefusal(undefined);

    // Signing in for an MCP client's authorization: on to its consent page, or back to the client.
    // The auth client follows that redirect by itself: navigating here too would cut it short.
    if (data.redirect && data.url !== undefined) {
      return;
    }

    // Into the app without a reload; its guard sends a temporary password to be changed first.
    await navigate({ to: "/" });
  }

  return (
    <Screen>
      <Card title={m.signInTitle()} description={m.signInDescription()}>
        <Form onSubmit={(event) => void submit(event)} onInput={() => setRefusal(undefined)}>
          <TextField
            label={m.fieldEmail()}
            name="email"
            type="email"
            autoComplete="email"
            required
            error={refusalMessage(refusal, "email")}
          />
          <TextField
            label={m.fieldPassword()}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={refusalMessage(refusal, "password")}
          />
          <FormMessage message={refusalMessage(refusal, undefined)} />
          <Button type="submit" loading={busy}>
            {m.signInSubmit()}
          </Button>
        </Form>
      </Card>
    </Screen>
  );
}
