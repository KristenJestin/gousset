/** How many characters of a file's name stay whole at its end: dates and an extension. */
const KEPT_END = 28;

/** Splits text into what a reader sees as characters (an accent with its letter, an emoji). */
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The characters of a text, as a reader sees them. */
export function charactersOf(text: string): Array<string> {
  return Array.from(graphemes.segment(text), ({ segment }) => segment);
}

/**
 * A file's name cut in two for a narrow column: the start, which gives way with an ellipsis, and
 * the end, kept whole. Every export of one bank starts the same way; its end (the period, the
 * extension) is what tells two statements apart. Counted in characters as a reader sees them, so
 * that none is cut in two.
 */
export function splitFileName(name: string, keep = KEPT_END) {
  const characters = charactersOf(name);
  const at = Math.max(characters.length - keep, 0);

  return { start: characters.slice(0, at).join(""), end: characters.slice(at).join("") };
}
