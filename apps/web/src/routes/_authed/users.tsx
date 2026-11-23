import { m } from "@gousset/i18n/messages";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { createUser, listUsers, resetPassword } from "@/functions/users";
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
  const [reset, setReset] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirmReset(name: string) {
    setReset(m.usersResetDone({ name }));
    await router.invalidate();
  }

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
              action={
                // The administrator changes their own password themselves, knowing the current one.
                user.isAdmin ? undefined : <ResetPassword user={user} onReset={confirmReset} />
              }
            />
          ))}
        </List>
        <StatusMessage message={reset} />
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

/**
 * The dialog that gives one user a new temporary password, from their row: they change it at the
 * next sign-in, and every device and MCP client signed in as them is signed out. Motion: the
 * shared `Dialog`'s, 200 ms in and out, cut under reduced motion.
 */
function ResetPassword({
  user,
  onReset,
}: {
  user: { id: string; name: string };
  onReset: (name: string) => Promise<void>;
}) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function follow(next: boolean) {
    setOpen(next);
    setError(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    const result = await whileBusy(setBusy, () =>
      resetPassword({ data: { userId: user.id, password: formText(form, "password") } }),
    );

    if (!result.reset) {
      setError(errorMessage(result.code));

      return;
    }

    follow(false);
    await onReset(user.name);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={follow}
      title={m.usersResetTitle({ name: user.name })}
      description={m.usersResetDescription()}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          aria-label={m.usersResetPasswordOf({ name: user.name })}
        >
          {m.usersResetPassword()}
        </Button>
      }
      actions={
        <>
          <DialogClose>
            <Button variant="secondary">{m.uiCancel()}</Button>
          </DialogClose>
          <Button type="submit" form={formId} loading={busy}>
            {m.usersResetPassword()}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        onSubmit={(event) => void submit(event)}
        onInput={() => setError(undefined)}
      >
        <TextField
          label={m.fieldTemporaryPassword()}
          name="password"
          type="text"
          autoComplete="off"
          minLength={8}
          required
        />
        <FormMessage message={error} />
      </Form>
    </Dialog>
  );
}
