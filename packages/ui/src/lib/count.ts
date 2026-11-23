// Counts as people read them (lines read, lines added): whole numbers with the locale's
// separators, `1,204` in English and `1 204` in French.

/** One formatter per language, built once: building one is slow. */
const formatters = new Map<string, Intl.NumberFormat>();

function countFormat(locale: string): Intl.NumberFormat {
  const known = formatters.get(locale);

  if (known !== undefined) {
    return known;
  }

  const made = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  formatters.set(locale, made);

  return made;
}

/** A count's pieces (digits, group separators), as the digits' roll takes them. */
export function countParts(count: number, locale: string): Array<Intl.NumberFormatPart> {
  return countFormat(locale).formatToParts(count);
}

/** A count as text: `1,204`, `1 204` in French. */
export function formatCount(count: number, locale: string): string {
  return countFormat(locale).format(count);
}
