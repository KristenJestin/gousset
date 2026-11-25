// What a bank says a line is, in the words it starts the label with (#194): a card payment, its
// cancellation, a transfer, a loan's instalment, a fee… Recognition reads them as the operation, never
// as part of the merchant (docs/data-model.md, v0.3, "Operation prefixes"). Pure: no I/O.

/** What a label's operation prefix says the line is. */
export type Operation =
  | "card"
  | "card_cancellation"
  | "direct_debit"
  | "transfer"
  | "loan"
  | "fee"
  | "interest"
  | "cheque_deposit"
  | "withdrawal";

/**
 * What an operation says of the line's merchant: the rest of the label names it (`rest`), only a
 * party the label names with a marker (`/DE`, `POUR:`…) or the counterparty's name the format gives
 * can (`party`), or nothing does (`none`).
 */
export type OperationMerchant = "rest" | "party" | "none";

export const OPERATION_MERCHANT = {
  card: "rest",
  // A refund of the payment it cancels, at the same shop: #27's refund matching proposes the link.
  card_cancellation: "rest",
  direct_debit: "rest",
  transfer: "party",
  loan: "none",
  fee: "none",
  interest: "none",
  cheque_deposit: "none",
  withdrawal: "none",
} as const satisfies { readonly [operation in Operation]: OperationMerchant };

/** A prefix, in upper-case ASCII words separated by one space, and what it says. */
export type OperationPrefix = { readonly prefix: string; readonly operation: Operation };

/**
 * French banks' prefixes. A prefix is matched whole, at the label's start, followed by a space or
 * the label's end: `F` is a fee in `F COTISATION CARTE`, never in `FNAC`, and `VIR` a transfer in
 * `VIR SEPA …`, never in `VIREMENT GRATUIT`.
 */
const FRENCH: ReadonlyArray<OperationPrefix> = [
  { prefix: "CARTE", operation: "card" },
  { prefix: "CB", operation: "card" },
  { prefix: "ANN CARTE", operation: "card_cancellation" },
  { prefix: "PRLV", operation: "direct_debit" },
  { prefix: "VIR", operation: "transfer" },
  { prefix: "VIR SEPA", operation: "transfer" },
  { prefix: "ECH PRET", operation: "loan" },
  { prefix: "F", operation: "fee" },
  { prefix: "FRAIS", operation: "fee" },
  { prefix: "INTERETS", operation: "interest" },
  { prefix: "REMISE CHEQUE", operation: "cheque_deposit" },
  { prefix: "RETRAIT", operation: "withdrawal" },
];

/**
 * Every bank style's prefixes, the longest first, so that `ANN CARTE` is read before `CARTE` and
 * `VIR SEPA` before `VIR`. A bank's set is added as one more list above, joined here, with its
 * invented labels in `labels.test.ts`.
 */
export const OPERATION_PREFIXES: ReadonlyArray<OperationPrefix> = [...FRENCH].toSorted(
  (a, b) => b.prefix.length - a.prefix.length,
);
