import { m } from "@gousset/i18n/messages";
import { FormMessage } from "@gousset/ui/components/form-message";
import { TextField } from "@gousset/ui/components/text-field";
import { useState } from "react";
import type { FormEvent } from "react";

import { passwordRules, refusalMessage, refusalOf } from "@/i18n/messages";
import type { Refusal } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import { emptyPasswords, formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";

/**
 * Changing one's own password, wherever its form stands: the page a temporary password leads to,
 * or the dialog of the settings. Other devices are signed out. A refusal is said under the field
 * at fault (#80) and empties both passwords; `onChanged` runs once the account holds the new one.
 */
export function useChangePassword(onChanged: () => Promise<void> | void) {
  const [refusal, setRefusal] = useState<Refusal>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const { error: refused } = await whileBusy(setBusy, () =>
      authClient.changePassword({
        currentPassword: formText(form, "currentPassword"),
        newPassword: formText(form, "newPassword"),
        revokeOtherSessions: true,
      }),
    );

    if (refused) {
      setRefusal(refusalOf(refused.code));
      emptyPasswords(formElement, ["currentPassword", "newPassword"]);

      return;
    }

    setRefusal(undefined);
    await onChanged();
  }

  return { refusal, busy, submit, clearRefusal: () => setRefusal(undefined) };
}

/** The form's two fields, the rules under the new one, and a refusal that names no field. */
export function ChangePasswordFields({ refusal }: { refusal: Refusal | undefined }) {
  return (
    <>
      <TextField
        label={m.fieldCurrentPassword()}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={refusalMessage(refusal, "currentPassword")}
      />
      <TextField
        label={m.fieldNewPassword()}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        description={passwordRules()}
        error={refusalMessage(refusal, "password")}
      />
      <FormMessage message={refusalMessage(refusal, undefined)} />
    </>
  );
}
