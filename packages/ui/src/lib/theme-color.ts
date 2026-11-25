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

/** The system's scheme each theme colour is for. */
const mediaOf = (scheme: ColorScheme) => `(prefers-color-scheme: ${scheme})`;

/** The scheme of the system a theme colour's `media` names; light for any other. */
export const schemeOfMedia = (media: string): ColorScheme =>
  media === mediaOf("dark") ? "dark" : "light";

/**
 * The page's theme colours, as the server writes them in its `<head>`: one per scheme of the
 * system. `followThemeColor` puts the user's own choice over them once the page runs.
 */
export const themeColorMetas = () =>
  SCHEMES.map((scheme) => ({
    name: "theme-color",
    content: THEME_COLORS[scheme],
    media: mediaOf(scheme),
  }));
