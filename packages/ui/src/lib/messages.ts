// The texts `packages/ui` writes on its own (a retry button, a toast's wording), in English and
// French, held as the app holds its own (`apps/web/src/i18n/messages.ts`) until Paraglide comes
// (#8). A text that names the user's data is given by the page as a prop, never written here.
//
// Each component family adds its own section below; the French object must match the English.

const en = {
  loading: "Loading",
  states: {
    errorTitle: "This could not be loaded",
    errorMessage: "Something went wrong on the way. The rest of the page still works.",
    retry: "Retry",
  },
  pieces: {
    uncategorised: "Uncategorised",
    month: "Month",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    remove: (name: string) => `Remove ${name}`,
  },
};

export type UiMessages = typeof en;

const fr: UiMessages = {
  loading: "Chargement",
  states: {
    errorTitle: "Impossible de charger ce bloc",
    errorMessage: "Un problème est survenu en route. Le reste de la page fonctionne toujours.",
    retry: "Réessayer",
  },
  pieces: {
    uncategorised: "Sans catégorie",
    month: "Mois",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    remove: (name: string) => `Retirer ${name}`,
  },
};

export const UI_LOCALES = ["en", "fr"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

const byLocale = { en, fr } satisfies { [Locale in UiLocale]: UiMessages };

/** The ui's texts for a language tag ("fr", "fr-FR"); English for any other. */
export function uiMessagesFor(languageTag: string | undefined): UiMessages {
  return (languageTag ?? "").toLowerCase().startsWith("fr") ? byLocale.fr : byLocale.en;
}

/**
 * The ui's texts in the page's language: `<html lang>`, which the app sets (English on the
 * server and without it). Read where no React tree is at hand, like `notify`.
 */
export function pageMessages(): UiMessages {
  return uiMessagesFor(typeof document === "undefined" ? undefined : document.documentElement.lang);
}
