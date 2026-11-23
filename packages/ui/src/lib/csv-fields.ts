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

export type CsvField = (typeof CSV_FIELDS)[number];
