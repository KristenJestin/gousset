// The texts `packages/ui` writes on its own (a retry button, a toast's wording), in English and
// French, held as the app holds its own (`apps/web/src/i18n/messages.ts`) until Paraglide comes
// (#8). A text that names the user's data is given by the page as a prop, never written here.
//
// Each component family adds its own section below; the French object must match the English.

const en = {
  loading: "Loading",
  states: {
    errorTitle: "This block could not be loaded",
    errorMessage: "Something went wrong on the way. The rest of the page still works.",
    retry: "Try again",
  },
  pieces: {
    uncategorised: "Uncategorised",
    month: "Month",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    remove: (name: string) => `Remove ${name}`,
  },
  forms: {
    noMatch: "Nothing matches this search.",
    results: (count: number) => (count === 1 ? "1 result" : `${count} results`),
    showOptions: "Show the options",
    chooseDate: "Choose a date",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    dateFormat: (example: string) => `As in ${example}`,
    /** The calendar's language (month and day names, the typed date's order). */
    dateLocale: "en",
    /** The calendar's first day of the week, 0 for Sunday. */
    weekStartsOn: 0,
  },
  overlays: {
    close: "Close",
    cancel: "Cancel",
  },
  charts: {
    /** The language of the amounts, days and months a chart writes. */
    locale: "en",
    empty: "Nothing spent yet in this period.",
  },
  notify: {
    /** The toasts' landmark, reached with F6. */
    region: "Notifications",
    saved: "Saved",
    failed: "Something went wrong",
    retry: "Retry",
    /** A progress toast's title when the caller gives none. */
    working: "Working…",
    /** A progress toast resolved without a title of the caller's. */
    done: "Done",
    undo: "Undo",
    undone: "Undone",
    undoFailed: "Couldn't undo",
    dismiss: "Dismiss",
    /** Said once a toast's button has been working for a second. */
    pending: "Still working",
  },
  money: {
    /** After the amount: "€3,120 received". */
    received: "received",
    /** Each part of the month bar, after its amount. */
    roles: { spent: "spent", saved: "set aside", left: "left" },
    /** In place of "left" when more went out than came in. */
    overspent: "overspent",
    /** The month bar's parts, as a group. */
    parts: "The month's money, by part",
    /** A change and what it is against ("5%", "your 6-month average"). */
    deltaMore: (change: string, reference: string) => `${change} more than ${reference}`,
    deltaLess: (change: string, reference: string) => `${change} less than ${reference}`,
    deltaSteady: (reference: string) => `About the same as ${reference}`,
    overBenchmark: "Above the benchmark",
    benchmark: (amount: string) => `benchmark ${amount}`,
    moreRows: (count: number) => `+ ${count} more`,
    empty: "Nothing to show this month.",
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
  forms: {
    noMatch: "Rien ne correspond à cette recherche.",
    results: (count: number) => (count <= 1 ? `${count} résultat` : `${count} résultats`),
    showOptions: "Afficher les choix",
    chooseDate: "Choisir une date",
    previousMonth: "Mois précédent",
    nextMonth: "Mois suivant",
    dateFormat: (example: string) => `Par exemple ${example}`,
    dateLocale: "fr",
    weekStartsOn: 1,
  },
  overlays: {
    close: "Fermer",
    cancel: "Annuler",
  },
  charts: {
    locale: "fr",
    empty: "Aucune dépense sur cette période pour l’instant.",
  },
  notify: {
    region: "Notifications",
    saved: "Enregistré",
    failed: "Un problème est survenu",
    retry: "Réessayer",
    working: "En cours…",
    done: "Terminé",
    undo: "Annuler",
    undone: "Annulé",
    undoFailed: "Impossible d’annuler",
    dismiss: "Fermer",
    pending: "Toujours en cours",
  },
  money: {
    received: "reçus",
    roles: { spent: "dépensés", saved: "mis de côté", left: "restants" },
    overspent: "de dépassement",
    parts: "L’argent du mois, par part",
    deltaMore: (change: string, reference: string) => `${change} de plus que ${reference}`,
    deltaLess: (change: string, reference: string) => `${change} de moins que ${reference}`,
    deltaSteady: (reference: string) => `À peu près comme ${reference}`,
    overBenchmark: "Au-dessus du repère",
    benchmark: (amount: string) => `repère ${amount}`,
    moreRows: (count: number) => `+ ${count} de plus`,
    empty: "Rien à afficher ce mois-ci.",
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
