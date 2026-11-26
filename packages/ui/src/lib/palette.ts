import { CATEGORY_COLORS, isCategoryColor } from "@gousset/core/category-looks";
import type { CategoryColorKey } from "@gousset/core/category-looks";

// The palette a user tints their data with (a category's colour, #205), as Tailwind classes: one
// literal class per key and use, so that Tailwind finds each one and no class is built at run
// time. The colours are `--palette-<key>` in `globals.css`; their keys are packages/core's.

/** The palette's keys, in the order they are offered. */
export const PALETTE_COLORS = CATEGORY_COLORS;

export type PaletteColor = CategoryColorKey;

/** A small tile in the colour: its tint behind, the colour on it (an icon, initials). */
export const paletteTile = {
  red: "bg-palette-red/15 text-palette-red",
  orange: "bg-palette-orange/15 text-palette-orange",
  amber: "bg-palette-amber/15 text-palette-amber",
  olive: "bg-palette-olive/15 text-palette-olive",
  green: "bg-palette-green/15 text-palette-green",
  teal: "bg-palette-teal/15 text-palette-teal",
  cyan: "bg-palette-cyan/15 text-palette-cyan",
  blue: "bg-palette-blue/15 text-palette-blue",
  indigo: "bg-palette-indigo/15 text-palette-indigo",
  violet: "bg-palette-violet/15 text-palette-violet",
  pink: "bg-palette-pink/15 text-palette-pink",
  grey: "bg-palette-grey/15 text-palette-grey",
} as const satisfies { [Color in PaletteColor]: string };

/** An icon drawn in the colour, on the page's own surface. */
export const paletteText = {
  red: "text-palette-red",
  orange: "text-palette-orange",
  amber: "text-palette-amber",
  olive: "text-palette-olive",
  green: "text-palette-green",
  teal: "text-palette-teal",
  cyan: "text-palette-cyan",
  blue: "text-palette-blue",
  indigo: "text-palette-indigo",
  violet: "text-palette-violet",
  pink: "text-palette-pink",
  grey: "text-palette-grey",
} as const satisfies { [Color in PaletteColor]: string };

/** An SVG shape filled with the colour: a bar, a part. */
export const paletteFill = {
  red: "fill-palette-red",
  orange: "fill-palette-orange",
  amber: "fill-palette-amber",
  olive: "fill-palette-olive",
  green: "fill-palette-green",
  teal: "fill-palette-teal",
  cyan: "fill-palette-cyan",
  blue: "fill-palette-blue",
  indigo: "fill-palette-indigo",
  violet: "fill-palette-violet",
  pink: "fill-palette-pink",
  grey: "fill-palette-grey",
} as const satisfies { [Color in PaletteColor]: string };

/** A box filled with the colour: a dot, a swatch. */
export const paletteBackground = {
  red: "bg-palette-red",
  orange: "bg-palette-orange",
  amber: "bg-palette-amber",
  olive: "bg-palette-olive",
  green: "bg-palette-green",
  teal: "bg-palette-teal",
  cyan: "bg-palette-cyan",
  blue: "bg-palette-blue",
  indigo: "bg-palette-indigo",
  violet: "bg-palette-violet",
  pink: "bg-palette-pink",
  grey: "bg-palette-grey",
} as const satisfies { [Color in PaletteColor]: string };

/** Whether a stored key is one of the palette's. */
export const isPaletteColor = isCategoryColor;
