/**
 * The interface's texts, in English and French. A stopgap until the messages move to Paraglide
 * (issue #8), which will replace this file: keys stay the same.
 */
const en = {
  "dialog.close": "Close",
  "shortcuts.title": "Keyboard shortcuts",
  "hotkeys.shortcuts.show": "Show keyboard shortcuts",
  "hotkeys.search.open": "Search",
  "search.title": "Search",
  "search.empty": "Nothing to search yet.",
};

export type Messages = typeof en;

const fr: Messages = {
  "dialog.close": "Fermer",
  "shortcuts.title": "Raccourcis clavier",
  "hotkeys.shortcuts.show": "Afficher les raccourcis clavier",
  "hotkeys.search.open": "Rechercher",
  "search.title": "Recherche",
  "search.empty": "Rien à rechercher pour l’instant.",
};

/** The messages in the browser's first language, French or English; English on the server. */
export function browserMessages(): Messages {
  const [language] = typeof navigator === "undefined" ? [] : navigator.languages;

  return language?.toLowerCase().startsWith("fr") === true ? fr : en;
}
