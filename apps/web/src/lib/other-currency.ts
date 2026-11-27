import type { MonthSummary } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import type { Locale } from "@gousset/i18n/runtime";
import { formatMoney } from "@gousset/ui/lib/money";

/** One other currency of the month, as the summary gives it apart. */
type OtherCurrency = MonthSummary["elsewhere"][number];

/**
 * A currency of the month other than the user's, in one sentence: its figures, never converted,
 * and what waits there as possible refunds, which its received leaves out (#208).
 */
export function otherCurrencyNote(other: OtherCurrency, locale: Locale): string {
  const whole = (money: OtherCurrency["received"]) => formatMoney(money, { locale, whole: true });

  const figures = {
    currency: other.currency,
    received: whole(other.received),
    spent: whole(other.spent),
    setAside: whole(other.setAside),
    left: whole(other.left),
  };

  return other.maybeRefunds.minor === 0
    ? m.reviewOtherCurrency(figures, { locale })
    : m.reviewOtherCurrencyWaiting(
        { ...figures, maybeRefunds: whole(other.maybeRefunds) },
        { locale },
      );
}
