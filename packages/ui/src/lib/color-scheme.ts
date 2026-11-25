import { createColorScheme, createLocalStorage } from "@ui-sdk/core";
import type { ColorSchemeValue } from "@ui-sdk/core";

import { THEME_COLORS, schemeOfMedia } from "./theme-color";

/** Where this browser keeps the choice: the one used before anyone signs in. */
const STORAGE_KEY = "gousset-color-scheme";

/**
 * The colour scheme: "system" by default, "light" or "dark" by choice. ui-sdk keeps the choice
 * and puts it on `<html data-color-scheme>`, which `globals.css` maps to `color-scheme`; the
 * choice is saved in this browser and applied before the first paint. Signed in, the account's
 * choice takes its place (`ThemeProvider`'s `accountScheme`).
 */
export const colorScheme = createColorScheme({
  storage: createLocalStorage(STORAGE_KEY),
  global: true,
});

/**
 * The inline script that puts the account's choice in this browser's place, rendered by the
 * server just before ui-sdk's own, which then paints it from the start: another user's choice
 * left in this browser never shows, not even for a frame. The value is one of the three choices;
 * JSON quotes it.
 */
export function accountSchemeScript(scheme: ColorSchemeValue): string {
  return `try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(scheme)})}catch(e){}`;
}

/**
 * Keeps `.dark` on `root` while the scheme shows dark, so code that looks for the class (Bklit's
 * convention) follows the same choice. Returns the function that stops it.
 */
export function followDarkClass(root: HTMLElement): () => void {
  const apply = () => {
    root.classList.toggle("dark", colorScheme.get().resolved === "dark");
  };

  apply();

  return colorScheme.subscribe(apply);
}

/**
 * Keeps the browser's bars on the scheme shown. The server's page gives one theme colour per scheme
 * of the system (`media`); a scheme the user chose wins over the system's, so each then takes that
 * scheme's colour, and following the system again gives each its own back. Returns the function
 * that stops it.
 */
export function followThemeColor(head: HTMLHeadElement): () => void {
  const apply = () => {
    const { value, resolved } = colorScheme.get();

    for (const meta of head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content =
        value === "system" || resolved === "unknown"
          ? THEME_COLORS[schemeOfMedia(meta.media)]
          : THEME_COLORS[resolved];
    }
  };

  apply();

  return colorScheme.subscribe(apply);
}
