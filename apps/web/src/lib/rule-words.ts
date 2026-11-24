import { m } from "@gousset/i18n/messages";
import { formatCount } from "@gousset/ui/lib/count";

/** Which plural form a count takes, per language: built once, since building one is slow. */
const plurals = new Map<string, Intl.PluralRules>();

function isOne(count: number, locale: string): boolean {
  const known = plurals.get(locale) ?? new Intl.PluralRules(locale);

  plurals.set(locale, known);

  return known.select(count) === "one";
}

/** "12 lines changed", "1 line changed": what a rule applied to the past did. */
export function linesChanged(count: number, locale: string): string {
  const written = formatCount(count, locale);

  return isOne(count, locale)
    ? m.rulesAppliedOne({ count: written })
    : m.rulesAppliedOther({ count: written });
}
