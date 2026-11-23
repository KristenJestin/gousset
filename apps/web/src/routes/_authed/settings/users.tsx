import { m } from "@gousset/i18n/messages";
import { Block } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { Dialog } from "@gousset/ui/components/dialog";
import { FormMessage } from "@gousset/ui/components/form-message";
import { List, ListItem } from "@gousset/ui/components/list";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { TextField } from "@gousset/ui/components/text-field";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { createUser, listUsers, resetPassword } from "@/functions/users";
import { passwordRules, refusalMessage, refusalOf } from "@/i18n/messages";
import type { Refusal } from "@/i18n/messages";
import { emptyPasswords, formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

/**
 * The administrator's section of the settings (docs/wireframes, `rules`: the settings' menu lists
 * the users): who has an account and, beside the list's title, the button that opens creating
 * another in a dialog; on each row but the administrator's, the button that opens giving that user
 * a new temporary password in a dialog (docs/design.md, "Actions and forms").
 */
export const Route = createFileRoute("/_authed/settings/users")({
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
  const users = Route.useLoaderData();
  const [done, setDone] = useState<string>();

  return (
    <Block
      title={m.usersTitle()}
      description={m.usersDescription()}
      actions={<CreateUser announce={setDone} />}
    >
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
              user.isAdmin ? undefined : <ResetPassword user={user} announce={setDone} />
            }
          />
        ))}
      </List>
      {/* In the page, not the dialog: it is said once the dialog has closed. */}
      <StatusMessage message={done} />
    </Block>
  );
}

/**
 * The "Create a user" button and its dialog. A refusal keeps the dialog open, said under the field
 * at fault; once the user is created the dialog closes (focus back on the button), the page says
 * who can now sign in and the list is read again. While a request runs the dialog stays open: its
 * answer always lands on the form that sent it.
 */
function CreateUser({ announce }: { announce: (message: string | undefined) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>();
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
      setRefusal(refusalOf(result.code));
      emptyPasswords(formElement, ["password"]);

      return;
    }

    // Closed before the list is read again: the filled form cannot be sent a second time.
    setRefusal(undefined);
    setOpen(false);
    announce(m.usersCreated({ name: result.name }));
    await router.invalidate();
  }

  return (
    <Dialog
      trigger={<Button icon="add">{m.usersCreateTitle()}</Button>}
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) {
          return;
        }

        setOpen(next);
        setRefusal(undefined);

        if (next) {
          announce(undefined);
        }
      }}
      title={m.usersCreateTitle()}
      description={m.usersCreateDescription()}
      onSubmit={(event) => void submit(event)}
      onInput={() => setRefusal(undefined)}
      actions={
        <Button type="submit" loading={busy}>
          {m.usersCreate()}
        </Button>
      }
    >
      <TextField label={m.fieldName()} name="name" autoComplete="off" required />
      <TextField
        label={m.fieldEmail()}
        name="email"
        type="email"
        autoComplete="off"
        required
        error={refusalMessage(refusal, "email")}
      />
      <TextField
        label={m.fieldTemporaryPassword()}
        name="password"
        type="text"
        autoComplete="off"
        required
        description={passwordRules()}
        error={refusalMessage(refusal, "password")}
      />
      <FormMessage message={refusalMessage(refusal, undefined)} />
    </Dialog>
  );
}

/**
 * A row's "Reset the password" button and its dialog, which gives that user a new temporary
 * password: they change it at the next sign-in, and every device and MCP client signed in as them
 * is signed out. As creating one: a refusal keeps the dialog open, said under the field at fault;
 * once reset the dialog closes (focus back on the row's button), the page says so and the list is
 * read again. Motion: the shared `Dialog`'s, 200 ms in and out, cut under reduced motion.
 */
function ResetPassword({
  user,
  announce,
}: {
  user: { id: string; name: string };
  announce: (message: string | undefined) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<Refusal>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const result = await whileBusy(setBusy, () =>
      resetPassword({ data: { userId: user.id, password: formText(form, "password") } }),
    );

    if (!result.reset) {
      setRefusal(refusalOf(result.code));
      emptyPasswords(formElement, ["password"]);

      return;
    }

    setRefusal(undefined);
    setOpen(false);
    announce(m.usersResetDone({ name: user.name }));
    await router.invalidate();
  }

  return (
    <Dialog
      trigger={
        <Button
          variant="secondary"
          size="sm"
          aria-label={m.usersResetPasswordOf({ name: user.name })}
        >
          {m.usersResetPassword()}
        </Button>
      }
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) {
          return;
        }

        setOpen(next);
        setRefusal(undefined);

        if (next) {
          announce(undefined);
        }
      }}
      title={m.usersResetTitle({ name: user.name })}
      description={m.usersResetDescription()}
      onSubmit={(event) => void submit(event)}
      onInput={() => setRefusal(undefined)}
      actions={
        <Button type="submit" loading={busy}>
          {m.usersResetPassword()}
        </Button>
      }
    >
      <TextField
        label={m.fieldTemporaryPassword()}
        name="password"
        type="text"
        autoComplete="off"
        required
        description={passwordRules()}
        error={refusalMessage(refusal, "password")}
      />
      <FormMessage message={refusalMessage(refusal, undefined)} />
    </Dialog>
  );
}
