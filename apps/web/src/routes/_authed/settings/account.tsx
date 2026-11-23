import { m } from "@gousset/i18n/messages";
import { Block } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { Dialog, DialogClose } from "@gousset/ui/components/dialog";
import { Actions, Form } from "@gousset/ui/components/screen";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";

import { ChangePasswordFields, useChangePassword } from "@/components/change-password";

/**
 * The user's own account: for now its password, changed in a dialog (#103: an action's form opens
 * in a dialog). A temporary password is still changed on its own page, before the app opens.
 */
export const Route = createFileRoute("/_authed/settings/account")({
  component: AccountSettings,
});

function AccountSettings() {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState<string>();

  const { refusal, busy, submit, clearRefusal } = useChangePassword(async () => {
    setOpen(false);
    setChanged(m.settingsPasswordChanged());
    // The session was renewed with the password: the root reads it again.
    await router.invalidate();
  });

  function openChange(next: boolean) {
    // Each opening starts afresh: no refusal of the last time, no "changed" left beside it.
    if (next) {
      clearRefusal();
      setChanged(undefined);
    }

    setOpen(next);
  }

  return (
    <Block title={m.settingsPasswordTitle()} description={m.settingsPasswordDescription()}>
      <Actions>
        <Dialog
          title={m.changePasswordTitle()}
          description={m.changePasswordDescription()}
          open={open}
          onOpenChange={openChange}
          trigger={<Button variant="secondary">{m.settingsChangePassword()}</Button>}
          actions={
            <>
              <DialogClose>
                <Button variant="secondary">{m.uiCancel()}</Button>
              </DialogClose>
              <Button type="submit" form={formId} loading={busy}>
                {m.changePasswordSubmit()}
              </Button>
            </>
          }
        >
          <Form id={formId} onSubmit={(event) => void submit(event)} onInput={clearRefusal}>
            <ChangePasswordFields refusal={refusal} />
          </Form>
        </Dialog>
      </Actions>
      <StatusMessage message={changed} />
    </Block>
  );
}
