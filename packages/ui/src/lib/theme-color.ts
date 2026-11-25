import type { ColorScheme } from "./contrast";

/**
 * The browser's own bars (`<meta name="theme-color">`: the status bar of an app installed on a
 * phone, the window's title bar on a desktop) in each scheme: the page's `--background`, written
 * `#rrggbb`, which every browser reads there. `contrast.test.ts` keeps them on the token.
 */
export const THEME_COLORS = {
  light: "#f8f7f4",
  dark: "#110f0d",
} as const satisfies { [Scheme in ColorScheme]: string };

const SCHEMES = ["light", "dark"] as const satisfies ReadonlyArray<ColorScheme>;

/**
 * The page's theme colours: one per scheme of the system (its `media`), each that scheme's colour
 * while the system's scheme shows, or every one the colour of the scheme shown by choice.
 */
export const themeColorMetas = (shown: ColorScheme | "system") =>
  SCHEMES.map((scheme) => ({
    content: THEME_COLORS[shown === "system" ? scheme : shown],
    media: `(prefers-color-scheme: ${scheme})`,
  }));
