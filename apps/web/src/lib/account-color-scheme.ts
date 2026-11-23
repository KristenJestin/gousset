import { notify } from "@gousset/ui/lib/notify";

import { setColorScheme } from "@/functions/color-scheme";
import type { ColorSchemeChoice } from "@/functions/color-scheme";
import { errorMessage } from "@/i18n/messages";

import { refusalOf } from "./refusal";

/** The one toast that says the last choice was not kept: a newer choice takes it away. */
const NOT_KEPT = "color-scheme-not-kept";

/** The saves on their way, one after the other, so that two quick choices land in their order. */
let saving: Promise<void> = Promise.resolve();

/** The user's last choice: only its save matters, the earlier ones are skipped or forgotten. */
let latest: ColorSchemeChoice | undefined;

/**
 * Keeps the colour scheme the user just chose, already applied, on their account. A refusal of
 * the last choice says so, with a retry: the account would otherwise give the previous choice back
 * on the next visit. A newer choice replaces it, toast and all.
 */
export function keepColorScheme(scheme: ColorSchemeChoice): Promise<void> {
  latest = scheme;
  notify.dismiss(NOT_KEPT);

  const save = async (): Promise<void> => {
    if (latest !== scheme) {
      return;
    }

    const refusal = await refusalOf(() => setColorScheme({ data: { scheme } }));

    if (refusal !== undefined && latest === scheme) {
      notify.failed({
        id: NOT_KEPT,
        description: errorMessage(refusal),
        retry: () => keepColorScheme(scheme),
      });
    }
  };

  saving = saving.then(save);

  return saving;
}

/**
 * Settles once every choice made so far reached the account: what a reload waits for (a change of
 * language), since the server paints the next page in the account's choice.
 */
export function colorSchemeKept(): Promise<void> {
  return saving;
}
