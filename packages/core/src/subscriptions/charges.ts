import {
  account,
  entry,
  entryPart,
  merchant,
  merchantAlias,
  statementLine,
} from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, eq, gte, lte } from "drizzle-orm";

import { merchantKey } from "../merchants/labels";
import type { Charge } from "./detection";

// What subscriptions are detected from (#34; docs/data-model.md, v0.4): the user's expenses, read
// in a transaction of theirs, each as one charge of one merchant in one currency. Nothing is stored:
// a split, a link, a merge, a moved cleaned label or a rule shows in the next read.

/** One payment of an expense, as the read gives it, before its expense is made one charge. */
export type ChargePart = {
  readonly entryId: string;
  readonly happenedOn: string;
  /** The expense's own merchant (a rule's, or the user's behind an intermediary); null for none. */
  readonly entryMerchantId: string | null;
  readonly amountMinor: number;
  readonly label: string;
  readonly counterpartyName: string | null;
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly currency: string;
};

/** A merchant as the charges name it. */
export type ChargeMerchant = {
  readonly name: string;
  readonly intermediary: boolean;
  readonly dismissed: boolean;
};

/**
 * Each expense made one charge, from its payments (its refunds are left out: a subscription is
 * what is billed):
 *
 * - its merchant is its own `merchant_id`, else the one its payment lines' cleaned labels name; an
 *   expense whose lines name several merchants, or none, is no one's, and left out;
 * - an intermediary is no one paid (#30): an expense whose merchant is one is left out, unless its
 *   own `merchant_id` names who was paid;
 * - a merchant the user dismissed (`subscription_dismissed`) is left out, every series of it;
 * - an expense paid by a movement of a balance (`source = balance`, #31) is left out: that line is a
 *   difference of balances, not a payment the bank billed;
 * - so is one paid in several currencies.
 */
export function chargesOf(
  parts: ReadonlyArray<ChargePart>,
  merchantOfAlias: ReadonlyMap<string, string>,
  merchants: ReadonlyMap<string, ChargeMerchant>,
): ReadonlyArray<Charge> {
  const byEntry = new Map<string, Array<ChargePart>>();

  for (const part of parts) {
    const known = byEntry.get(part.entryId);

    if (known === undefined) {
      byEntry.set(part.entryId, [part]);
    } else {
      known.push(part);
    }
  }

  return [...byEntry].flatMap(([entryId, payments]): ReadonlyArray<Charge> => {
    const [first] = payments;

    if (first === undefined || payments.some((part) => part.source === "balance")) {
      return [];
    }

    const currencies = new Set(payments.map((part) => part.currency));
    const own = first.entryMerchantId === null ? undefined : merchants.get(first.entryMerchantId);

    // The expense's own merchant counts when it is no intermediary, as a line's does (#30).
    const ownId = own === undefined || own.intermediary ? null : first.entryMerchantId;

    const labelIds = new Set(
      payments.map((part) => {
        const key = merchantKey(part.label, part.counterpartyName);

        return key === null ? null : (merchantOfAlias.get(key) ?? null);
      }),
    );

    const [labelId = null] = labelIds;
    const merchantId = ownId ?? (labelIds.size === 1 ? labelId : null);
    const chosen = merchantId === null ? undefined : merchants.get(merchantId);
    const [currency] = currencies;

    if (
      merchantId === null ||
      chosen === undefined ||
      chosen.intermediary ||
      chosen.dismissed ||
      currency === undefined ||
      currencies.size > 1
    ) {
      return [];
    }

    const amountMinor = payments.reduce((sum, part) => sum + part.amountMinor, 0);

    return amountMinor > 0
      ? [
          {
            id: entryId,
            merchantId,
            merchant: chosen.name,
            day: first.happenedOn,
            amountMinor,
            currency,
          },
        ]
      : [];
  });
}

/**
 * The user's expenses that happened from `from` to `to`, both included, as charges (`chargesOf`), in
 * `owner`'s transaction.
 */
export async function chargesIn(
  transaction: UserTransaction,
  range: { readonly from: string; readonly to: string },
): Promise<ReadonlyArray<Charge>> {
  const parts = await transaction
    .select({
      entryId: entry.id,
      happenedOn: entry.happenedOn,
      entryMerchantId: entry.merchantId,
      amountMinor: entryPart.amountMinor,
      label: statementLine.label,
      counterpartyName: statementLine.counterpartyName,
      source: statementLine.source,
      currency: account.currency,
    })
    .from(entry)
    .innerJoin(entryPart, and(eq(entryPart.entryId, entry.id), eq(entryPart.role, "payment")))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(entry.kind, "expense"),
        gte(entry.happenedOn, range.from),
        lte(entry.happenedOn, range.to),
      ),
    );

  if (parts.length === 0) {
    return [];
  }

  const aliases = await transaction
    .select({ alias: merchantAlias.alias, merchantId: merchantAlias.merchantId })
    .from(merchantAlias);

  const merchants = await transaction
    .select({
      id: merchant.id,
      name: merchant.name,
      intermediary: merchant.isIntermediary,
      dismissed: merchant.subscriptionDismissed,
    })
    .from(merchant);

  return chargesOf(
    parts,
    new Map(aliases.map((row) => [row.alias, row.merchantId])),
    new Map(merchants.map(({ id, ...row }) => [id, row])),
  );
}
