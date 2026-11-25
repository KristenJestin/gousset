import type { ColorSchemeValue } from "@ui-sdk/core";
import { useSyncExternalStore } from "react";

import { colorScheme } from "../lib/color-scheme";
import { themeColorMetas } from "../lib/theme-color";

/** The scheme the page shows: chosen, or the system's. */
function shownScheme() {
  const { value, resolved } = colorScheme.get();

  return value === "system" || resolved === "unknown" ? "system" : resolved;
}

const subscribe = (listener: () => void) => colorScheme.subscribe(listener);

export type ThemeColorProps = {
  /** The signed-in user's colour scheme, which the server's page shows from the first paint. */
  accountScheme?: ColorSchemeValue;
};

/**
 * The browser's own bars (`<meta name="theme-color">`), in `<head>`: the page's background, one
 * per scheme of the system, or each the chosen scheme's. The server writes the account's scheme;
 * once in the browser they follow the scheme the page shows (a choice, a sign-out), never a value
 * of the account read at another moment.
 */
export function ThemeColor({ accountScheme }: ThemeColorProps) {
  const shown = useSyncExternalStore(subscribe, shownScheme, () => accountScheme ?? "system");

  return themeColorMetas(shown).map(({ media, content }) => (
    <meta key={media} name="theme-color" media={media} content={content} />
  ));
}
