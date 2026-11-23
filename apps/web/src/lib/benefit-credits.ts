import type { AccountCredits } from "@gousset/core";
import type { CreditOrder } from "@gousset/core/account-values";
import { m } from "@gousset/i18n/messages";
import type { BenefitCreditsProps } from "@gousset/ui/components/benefit-credits";

import { shortDay } from "./account-day";

// A benefit account's credits as `BenefitCredits` shows them: every day and word already written,
// in the page's language, so that the page composes the component without text of its own.

const ORDER_LABELS = {
  oldest_first: m.accountCreditOrderOldestFirst,
  expiring_first: m.accountCreditOrderExpiringFirst,
} satisfies { readonly [Order in CreditOrder]: () => string };

/** The order of use's words ("Oldest first"). */
export function creditOrderLabel(order: CreditOrder): string {
  return ORDER_LABELS[order]();
}

/** The id `BenefitCredits` gives the opening balance, which is no line. */
export const OPENING_CREDIT_ID = "opening";

/**
 * `BenefitCredits`' props but `onEditExpiry`, from the account's credits on `today`: a day before
 * it is expired; what is uncovered is given only when there is some.
 */
export function benefitCreditsOf(
  credits: AccountCredits,
  today: string,
  locale: string,
): Omit<BenefitCreditsProps, "onEditExpiry"> {
  return {
    order: creditOrderLabel(credits.order),
    expiring: credits.expiring.map((entry) => ({
      day: shortDay(entry.day, locale),
      amount: entry.amount,
      expired: entry.day < today,
    })),
    credits: credits.open.map((credit) => ({
      id: credit.lineId ?? OPENING_CREDIT_ID,
      day: credit.creditedOn === null ? null : shortDay(credit.creditedOn, locale),
      label: credit.lineId === null ? m.accountCreditsOpeningBalance() : (credit.label ?? ""),
      amount: credit.amount,
      left: credit.left,
      expires: credit.expiresOn === null ? null : shortDay(credit.expiresOn, locale),
      expired: credit.expiresOn !== null && credit.expiresOn < today,
    })),
    uncovered: credits.uncovered.minor > 0 ? credits.uncovered : undefined,
  };
}

/**
 * A credit line's tag in the lines list ("expires Dec 31", or past `today` "Expired on Oct 15,
 * still counted"); none for a line without expiry.
 */
export function creditExpiryTag(
  expiresOn: string | null,
  today: string,
  locale: string,
): string | undefined {
  if (expiresOn === null) {
    return undefined;
  }

  const day = shortDay(expiresOn, locale);

  return expiresOn < today
    ? m.uiAccountsCreditsExpiredOn({ day })
    : m.uiAccountsCreditsExpires({ day });
}
