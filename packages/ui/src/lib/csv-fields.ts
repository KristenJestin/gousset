/** What a column of a CSV file can hold, as an import profile reads it; `ignored` for nothing. */
export const CSV_FIELDS = [
  "bookedOn",
  "valueOn",
  "label",
  "memo",
  "amount",
  "debit",
  "credit",
  "bankId",
  "currency",
  "ignored",
] as const;

/**
 * What a column of a broker's export can hold, as a profile of operations reads it (v0.6): the
 * day, the kind of operation, the security, the quantity and the price, the fees, the cash moved.
 */
export const OPERATION_FIELDS = [
  "bookedOn",
  "valueOn",
  "kind",
  "isin",
  "securityName",
  "securityCurrency",
  "quantity",
  "unitPrice",
  "fees",
  "amount",
  "label",
  "reference",
  "ignored",
] as const;

export type CsvField = (typeof CSV_FIELDS)[number] | (typeof OPERATION_FIELDS)[number];
