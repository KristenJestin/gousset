// What `MerchantLogo` draws without a logo: the name's initials on a tile whose tone comes from
// the name itself, so a merchant keeps the same tile on every screen and every visit.

const WORD = /[\p{L}\p{N}]+/gu;

/** One or two letters from a merchant's name: "Corner Bistro" → "CB", "Greenmarket" → "G". */
export function initialsOf(name: string): string {
  const words = name.match(WORD) ?? [];
  let initials = "";

  for (const word of words.slice(0, 2)) {
    initials += Array.from(word)[0] ?? "";
  }

  return initials === "" ? "?" : initials.toLocaleUpperCase();
}

/**
 * A stable index in `0..count-1` for a name (FNV-1a over its code points, case and spaces
 * ignored): the same name always gets the same tile, without any randomness.
 */
export function toneIndexOf(name: string, count: number): number {
  let hash = 0x81_1c_9d_c5;

  for (const character of name.toLocaleLowerCase().replaceAll(/\s+/gu, "")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }

  return hash % count;
}
