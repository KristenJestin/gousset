import { getLocale } from "@gousset/i18n/runtime";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  return () => observer.disconnect();
}

/**
 * The page's language (`<html lang>`, which the app sets), for `Intl` formats, following a change
 * of it; on the server, the request's language (Paraglide's); "en" when the page sets none.
 */
export function usePageLanguage(): string {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.lang === "" ? "en" : document.documentElement.lang),
    () => getLocale(),
  );
}
