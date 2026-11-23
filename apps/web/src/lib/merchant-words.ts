import { m } from "@gousset/i18n/messages";
import { formatCount } from "@gousset/ui/lib/count";

// The merchants pages' counts, worded in the page's language with the plural it takes.

/** Which plural form a count takes, per language: built once, since building one is slow. */
const plurals = new Map<string, Intl.PluralRules>();

function isOne(count: number, locale: string): boolean {
  const known = plurals.get(locale) ?? new Intl.PluralRules(locale);

  plurals.set(locale, known);

  return known.select(count) === "one";
}

/** "12 merchants", "1 merchant": how many match a search. */
export function merchantsCount(count: number, locale: string): string {
  const written = formatCount(count, locale);

  return isOne(count, locale)
    ? m.merchantsCountOne({ count: written })
    : m.merchantsCountOther({ count: written });
}

/** "3 labels", "1 label": how many cleaned labels name a merchant. */
export function labelsCount(count: number, locale: string): string {
  const written = formatCount(count, locale);

  return isOne(count, locale)
    ? m.merchantsLabelsOne({ count: written })
    : m.merchantsLabelsOther({ count: written });
}
