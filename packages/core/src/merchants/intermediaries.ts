import type { MerchantKey } from "./labels";

// Payment intermediaries (#30; docs/vision.md, "Payment intermediaries"): services that stand
// between the buyer and the merchant, whose name a bank's label gives in place of who was paid
// (`PAYLINK *PIXELPLAY` cleans to `PAYLINK`). A merchant recognition makes from one of these is
// marked as one; the user marks any other (`Merchants.markIntermediary`).

/** The intermediaries Gousset knows, as cleaned labels (`merchantKey`) compare: letters only. */
export const KNOWN_INTERMEDIARIES: ReadonlyArray<MerchantKey> = [
  "PAYPAL",
  "LYDIA",
  "SUMUP",
  "ZETTLE",
  "IZETTLE",
  "STRIPE",
  "KLARNA",
  "ALMA",
  "SCALAPAY",
  "MOLLIE",
  "PAYPLUG",
  "LEMONWAY",
  "MANGOPAY",
  "PAYCONIQ",
  "TWINT",
  "VENMO",
];

const KNOWN: ReadonlySet<string> = new Set(KNOWN_INTERMEDIARIES);

/**
 * Whether a cleaned label is a known intermediary's: its letters and digits are exactly one's name,
 * never a prefix, since `LYDIA MARTIN` is a person paid by transfer.
 */
export function isKnownIntermediary(key: MerchantKey): boolean {
  return KNOWN.has(key.replaceAll(/[^A-Z0-9]/g, ""));
}
