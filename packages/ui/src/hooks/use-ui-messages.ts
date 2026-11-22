import { useSyncExternalStore } from "react";

import { uiMessagesFor } from "../lib/messages";
import type { UiMessages } from "../lib/messages";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  return () => observer.disconnect();
}

/** The ui's texts in the page's language (`<html lang>`), following a change of it. */
export function useUiMessages(): UiMessages {
  const lang = useSyncExternalStore(
    subscribe,
    () => document.documentElement.lang,
    () => "en",
  );

  return uiMessagesFor(lang);
}
