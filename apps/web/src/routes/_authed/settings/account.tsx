import { m } from "@gousset/i18n/messages";
import { Block } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { Dialog } from "@gousset/ui/components/dialog";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { ChangePasswordFields, useChangePassword } from "@/components/change-password";

/**
 * The user's own account: for now its password and, beside the block's title, the button that
 * opens changing it in a dialog (docs/design.md, "Actions and forms"). A temporary password is
 * still changed on its own page, before the app opens.
 */
export const Route = createFileRoute("/_authed/settings/account")({
  component: AccountSettings,
});

function AccountSettings() {
  const [changed, setChanged] = useState<string>();

  return (
    <Block
      title={m.settingsPasswordTitle()}
      description={m.settingsPasswordDescription()}
      actions={<ChangePassword announce={setChanged} />}
    >
      {/* In the page, not the dialog: it is said once the dialog has closed. */}
      <StatusMessage message={changed} />
    </Block>
  );
}

/**
 * The "Change password" button and its dialog. A refusal keeps the dialog open, said under the
 * field at fault (#80); once changed the dialog closes (focus back on the button) and the page says
 * so. While the request runs the dialog stays open: its answer lands on the form that sent it.
 */
function ChangePassword({ announce }: { announce: (message: string | undefined) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { refusal, busy, submit, clearRefusal } = useChangePassword(async () => {
    setOpen(false);
    announce(m.settingsPasswordChanged());
    // The session was renewed with the password: the root reads it again.
    await router.invalidate();
  });

  return (
    <Dialog
      trigger={<Button variant="secondary">{m.settingsChangePassword()}</Button>}
      open={open}
      sending={busy}
      onOpenChange={(next) => {
        setOpen(next);
        clearRefusal();

        if (next) {
          announce(undefined);
        }
      }}
      title={m.changePasswordTitle()}
      description={m.changePasswordDescription()}
      onSubmit={(event) => void submit(event)}
      onInput={clearRefusal}
      actions={
        <Button type="submit" loading={busy}>
          {m.changePasswordSubmit()}
        </Button>
      }
    >
      <ChangePasswordFields refusal={refusal} />
    </Dialog>
  );
}
