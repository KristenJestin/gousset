import { m } from "@gousset/i18n/messages";
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
      setError(errorMessage(result.code));

      return;
    }

    setError(undefined);
    setCreated(m.usersCreated({ name: result.name }));
    formElement.reset();
    await router.invalidate();
  }

  return (
    <Screen>
      <Card title={m.usersTitle()} description={m.usersDescription()}>
        <List label={m.usersTitle()}>
          {users.map((user) => (
            <ListItem
              key={user.id}
              title={user.name}
              description={user.email}
              tags={[
                ...(user.isAdmin ? [m.usersAdministrator()] : []),
                ...(user.mustChangePassword ? [m.usersMustChangePassword()] : []),
              ]}
            />
          ))}
        </List>
      </Card>
      <Card title={m.usersCreateTitle()} description={m.usersCreateDescription()}>
        <Form onSubmit={(event) => void submit(event)} onInput={() => setError(undefined)}>
          <TextField label={m.fieldName()} name="name" autoComplete="off" required />
          <TextField label={m.fieldEmail()} name="email" type="email" autoComplete="off" required />
          <TextField
            label={m.fieldTemporaryPassword()}
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
              {m.usersCreate()}
            </Button>
            <AppLink to="/">{m.usersBack()}</AppLink>
          </Actions>
        </Form>
      </Card>
    </Screen>
  );
}
