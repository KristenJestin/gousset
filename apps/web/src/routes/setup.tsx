import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

/** A fresh install: the first visit creates the administrator. */
export const Route = createFileRoute("/setup")({
  beforeLoad: ({ context }) => {
    if (context.viewer.hasUsers) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/sign-in" });
    }
  },
  component: Setup,
});

function Setup() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const { error: refusal } = await whileBusy(setBusy, () =>
      authClient.signUp.email({
        name: formText(form, "name"),
        email: formText(form, "email"),
        password: formText(form, "password"),
      }),
    );

    if (refusal) {
      setError(errorMessage(refusal.code));

      return;
    }

    // Signed in by the sign-up: into the app, without a reload.
    await navigate({ to: "/" });
  }

  return (
    <Screen>
      <Card title={m.setupTitle()} description={m.setupDescription()}>
        <Form onSubmit={(event) => void submit(event)} onInput={() => setError(undefined)}>
          <TextField label={m.fieldName()} name="name" autoComplete="name" required />
          <TextField
            label={m.fieldEmail()}
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <TextField
            label={m.fieldPassword()}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <FormMessage message={error} />
          <Button type="submit" loading={busy}>
            {m.setupSubmit()}
          </Button>
        </Form>
      </Card>
    </Screen>
  );
}
