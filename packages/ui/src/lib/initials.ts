// What `Avatar` draws without a logo: the name's initials, on its colour.

const WORD = /[\p{L}\p{N}]+/gu;

/** One or two letters from a name: "Corner Bistro" → "CB", "Greenmarket" → "G". */
export function initialsOf(name: string): string {
  const words = name.match(WORD) ?? [];
  let initials = "";

  for (const word of words.slice(0, 2)) {
    initials += Array.from(word)[0] ?? "";
  }

  return initials === "" ? "?" : initials.toLocaleUpperCase();
}
