import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { createUser, listUsers } from "@/functions/users";
import { errorMessage } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

/** The administrator's page: who has an account, and creating the others. */
export const Route = createFileRoute("/_authed/users")({
  beforeLoad: ({ context }) => {
    if (!context.user.isAdmin) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({ to: "/" });
    }
  },
  loader: () => listUsers(),
  component: Users,
});

function Users() {
  const messages = useMessages();
  const router = useRouter();
  const users = Route.useLoaderData();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const result = await whileBusy(setBusy, () =>
      createUser({
        data: {
          name: formText(form, "name"),
          email: formText(form, "email"),
          password: formText(form, "password"),
        },
      }),
    );

    if (!result.created) {
      setCreated(undefined);
      setError(errorMessage(messages, result.code));

      return;
    }

    setError(undefined);
    setCreated(messages.users.created(result.name));
    formElement.reset();
    await router.invalidate();
  }

  return (
    <Screen>
      <Card title={messages.users.title} description={messages.users.description}>
        <List label={messages.users.title}>
          {users.map((user) => (
            <ListItem
              key={user.id}
              title={user.name}
              description={user.email}
              tags={[
                ...(user.isAdmin ? [messages.users.administrator] : []),
                ...(user.mustChangePassword ? [messages.users.mustChangePassword] : []),
              ]}
            />
          ))}
        </List>
      </Card>
      <Card title={messages.users.createTitle} description={messages.users.createDescription}>
        <Form onSubmit={(event) => void submit(event)} onInput={() => setError(undefined)}>
          <TextField label={messages.fields.name} name="name" autoComplete="off" required />
          <TextField
            label={messages.fields.email}
            name="email"
            type="email"
            autoComplete="off"
            required
          />
          <TextField
            label={messages.fields.temporaryPassword}
            name="password"
            type="text"
            autoComplete="off"
            minLength={8}
            required
          />
          <FormMessage message={error} />
          <StatusMessage message={created} />
          <Actions>
            <Button type="submit" loading={busy}>
              {messages.users.create}
            </Button>
            <AppLink to="/">{messages.users.back}</AppLink>
          </Actions>
        </Form>
      </Card>
    </Screen>
  );
}
