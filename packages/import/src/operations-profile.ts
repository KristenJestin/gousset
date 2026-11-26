import { Schema } from "effect";

import { Column, CsvProfile, DateFormat } from "./csv-profile";

// An import profile of the kind `operations` (docs/data-model.md, "Import profiles" and v0.6): how
// to read a broker's CSV export into operations rather than lines (README, "Brokers' operations").
// The database stores it whole as `import_profile.definition`, as a statement's; the same JSON is
// the file a user exports to share it. `reads` says what it reads, so that a shared file is never
// taken for a statement's profile; `version` lets a later schema read this shape.

/** What an operation is: the values of the database's `operation_kind`. */
export const OPERATION_KINDS = [
  "deposit",
  "withdrawal",
  "purchase",
  "sale",
  "dividend",
  "fee",
] as const;

export const OperationKind = Schema.Literals(OPERATION_KINDS);

export type OperationKind = typeof OperationKind.Type;

/** The most words a profile maps to kinds, and the longest word: a broker names a dozen. */
export const MAX_KIND_WORDS = 100;

export const MAX_KIND_WORD = 100;

/** A word of the file's kind column, and the kind of operation it names. */
const KindWord = Schema.Struct({
  word: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_KIND_WORD)),
  kind: OperationKind,
});

/** A broker whose export is read with its columns found by their names (README). */
export const BROKER_LAYOUTS = ["fortuneo", "degiro-transactions"] as const;

export type BrokerLayout = (typeof BROKER_LAYOUTS)[number];

/** An import profile of operations, version 1. */
export const OperationsProfile = Schema.Struct({
  version: Schema.Literal(1),
  reads: Schema.Literal("operations"),
  separator: CsvProfile.fields.separator,
  encoding: CsvProfile.fields.encoding,
  skipRows: CsvProfile.fields.skipRows,
  headerRow: Schema.Boolean,
  dateFormat: DateFormat,
  /** Every other mark groups thousands, by three digits, in amounts, quantities and prices. */
  decimalMark: CsvProfile.fields.decimalMark,
  /** Which column holds which field of an operation; `null` where none does. */
  columns: Schema.Struct({
    /** The day of the trade, as the broker dates the operation. */
    bookedOn: Column,
    /** Its settlement day. */
    valueOn: Schema.NullOr(Column),
    /**
     * The words that say what each row is, mapped by `kinds`. `null`: every row is a purchase or a
     * sale, told by the sign of its quantity (positive bought, negative sold), as Degiro writes.
     */
    kind: Schema.NullOr(Column),
    isin: Schema.NullOr(Column),
    securityName: Schema.NullOr(Column),
    /** The currency the security is quoted in, an ISO 4217 code; the account's when `null`. */
    securityCurrency: Schema.NullOr(Column),
    quantity: Schema.NullOr(Column),
    unitPrice: Schema.NullOr(Column),
    /** Fees, or a dividend's withholding tax, whatever their sign. */
    fees: Schema.NullOr(Column),
    /** The cash the operation moved, fees included: its sign is the kind's (README). */
    amount: Column,
    label: Schema.NullOr(Column),
    /** The broker's own reference for the row. */
    reference: Schema.NullOr(Column),
  }),
  /** The words of the kind column, compared trimmed, in any case, accents aside. */
  kinds: Schema.Array(KindWord).check(Schema.isMaxLength(MAX_KIND_WORDS)),
  /** Whether the broker makes `reference` unique to each row: the import then keys by it. */
  referenceUnique: Schema.Boolean,
  /**
   * A broker's export whose columns are found by their names (README, "Brokers' operations"):
   * `columns` then say where they stand in the header the profile ships with. Left out for a table
   * read by its columns' places.
   */
  layout: Schema.optionalKey(Schema.Literals(BROKER_LAYOUTS)),
});

export type OperationsProfile = typeof OperationsProfile.Type;

/**
 * What an import profile's definition is: a statement's (`CsvProfile`) or a broker's operations'
 * (`OperationsProfile`). An operations profile is tried first: a statement's lacks its `reads`.
 */
export const CsvDefinition = Schema.Union([OperationsProfile, CsvProfile]);

export type CsvDefinition = typeof CsvDefinition.Type;

/** Whether a definition reads a broker's operations rather than an account's lines. */
export function readsOperations(definition: CsvDefinition): definition is OperationsProfile {
  return "reads" in definition;
}

/** The highest column an operations profile reads: a header with fewer is another file's. */
export function lastOperationColumn(profile: OperationsProfile): number {
  return Math.max(...Object.values(profile.columns).filter((column) => column !== null));
}
