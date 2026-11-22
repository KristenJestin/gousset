import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { authClient } from "@/lib/auth-client";
import { formText } from "@/lib/form";
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
  const messages = useMessages();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const { data, error: refusal } = await whileBusy(setBusy, () =>
      authClient.signIn.email({
        email: formText(form, "email"),
        password: formText(form, "password"),
      }),
    );

    if (refusal) {
      setError(errorMessage(messages, refusal.code));

      return;
    }

    setError(undefined);

    // Signing in for an MCP client's authorization: on to its consent page, or back to the client.
    if (data.redirect && data.url !== undefined) {
      window.location.assign(data.url);

      return;
    }

    // Into the app without a reload; its guard sends a temporary password to be changed first.
    await navigate({ to: "/" });
  }

  return (
    <Screen>
      <Card title={messages.signIn.title} description={messages.signIn.description}>
        <Form onSubmit={(event) => void submit(event)} onInput={() => setError(undefined)}>
          <TextField
            label={messages.fields.email}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <TextField
            label={messages.fields.password}
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FormMessage message={error} />
          <Button type="submit" loading={busy}>
            {messages.signIn.submit}
          </Button>
        </Form>
      </Card>
    </Screen>
  );
}
