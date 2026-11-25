// The fixed palette a user picks a colour from (a merchant's avatar; a category's, later): the
// same keys, in the same order, as core stores (`packages/core/src/look.ts`). Each key is a pair
// of theme tokens in `globals.css`, a tile's colour and the text set on it, `light-dark()` both,
// 4.5:1 or more in each scheme (`contrast.test.ts`).

export const PALETTE_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export type PaletteColor = (typeof PALETTE_COLORS)[number];

/**
 * Each colour's tile and the text set on it, written out whole so that Tailwind sees every class
 * (a class built at run time would not exist).
 */
export const PALETTE_TILE_CLASSES = {
  gray: "bg-palette-gray text-palette-gray-foreground",
  red: "bg-palette-red text-palette-red-foreground",
  orange: "bg-palette-orange text-palette-orange-foreground",
  amber: "bg-palette-amber text-palette-amber-foreground",
  lime: "bg-palette-lime text-palette-lime-foreground",
  green: "bg-palette-green text-palette-green-foreground",
  teal: "bg-palette-teal text-palette-teal-foreground",
  cyan: "bg-palette-cyan text-palette-cyan-foreground",
  blue: "bg-palette-blue text-palette-blue-foreground",
  indigo: "bg-palette-indigo text-palette-indigo-foreground",
  violet: "bg-palette-violet text-palette-violet-foreground",
  pink: "bg-palette-pink text-palette-pink-foreground",
} as const satisfies { [Color in PaletteColor]: string };

/**
 * The colour a name gets until the user picks one: a stable hash of the name (FNV-1a over its
 * code points, case and spaces ignored) over the palette, so the same name keeps the same colour
 * on every screen and every visit, without any randomness.
 */
export function automaticColorOf(name: string): PaletteColor {
  let hash = 0x81_1c_9d_c5;

  for (const character of name.toLocaleLowerCase().replaceAll(/\s+/gu, "")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }

  return PALETTE_COLORS[hash % PALETTE_COLORS.length] ?? "gray";
}
