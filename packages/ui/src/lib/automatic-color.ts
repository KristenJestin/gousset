import { PALETTE_COLORS } from "./palette";
import type { PaletteColor } from "./palette";

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

  return PALETTE_COLORS[hash % PALETTE_COLORS.length] ?? "grey";
}
