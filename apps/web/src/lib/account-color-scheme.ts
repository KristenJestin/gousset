import { notify } from "@gousset/ui/lib/notify";

import { setColorScheme } from "@/functions/color-scheme";
import type { ColorSchemeChoice } from "@/functions/color-scheme";
import { errorMessage } from "@/i18n/messages";

import { refusalOf } from "./refusal";

/** The saves on their way, one after the other, so that two quick choices land in their order. */
let saving: Promise<void> = Promise.resolve();

/**
 * Keeps the colour scheme the user just chose, already applied, on their account. A refusal says
 * so, with a retry: the account would otherwise give the previous choice back on the next visit.
 */
export function keepColorScheme(scheme: ColorSchemeChoice): Promise<void> {
  const save = async (): Promise<void> => {
    const refusal = await refusalOf(() => setColorScheme({ data: { scheme } }));

    if (refusal !== undefined) {
      notify.failed({ description: errorMessage(refusal), retry: save });
    }
  };

  saving = saving.then(save);

  return saving;
}
