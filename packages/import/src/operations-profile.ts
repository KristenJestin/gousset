import { Effect, Schema, SchemaGetter } from "effect";

import { Column, CsvProfile, DateFormat } from "./csv-profile";

// An import profile of the kind `operations` (docs/data-model.md, "Import profiles" and v0.6): how
// to read a broker's CSV export into operations rather than lines (README, "Brokers' operations").
// The database stores it whole as `import_profile.definition`, as a statement's; the same JSON is
// the file a user exports to share it. `reads` says what it reads, so that a shared file is never
// taken for a statement's profile; `version` lets a later schema read this shape. Version 2 finds
// a column by its name as well as by its place, and reads an amount's currency and a trade's value;
// a profile of version 1 reads as it did, upgraded as it is decoded.

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

/** The most names a column is found by, and the longest. */
export const MAX_COLUMN_NAMES = 10;

export const MAX_COLUMN_NAME = 100;

/** A word of the file's kind column, and the kind of operation it names. */
const KindWord = Schema.Struct({
  word: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_KIND_WORD)),
  kind: OperationKind,
});

/** The names a header gives a column, compared trimmed, in any case, accents aside. */
const ColumnNames = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_COLUMN_NAME)),
).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_COLUMN_NAMES));

/**
 * Where a field stands: a column counted from 1; `{ "names": [...] }`, the first column of the
 * header row named one of them, wherever it stands, which the file must have unless `optional`;
 * `{ "after": [...] }`, the column right after the one so named when it has no name of its own,
 * as a broker writes an amount's currency there (Degiro), or none.
 */
export const ColumnPlace = Schema.Union([
  Column,
  Schema.Struct({ names: ColumnNames, optional: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ after: ColumnNames }),
]);

export type ColumnPlace = typeof ColumnPlace.Type;

/** A column the profile may leave out: `null` where none holds the field. */
const MaybeColumn = Schema.NullOr(ColumnPlace).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(null)),
);

/** An import profile of operations, version 2. */
export const OperationsProfile = Schema.Struct({
  version: Schema.Literal(2),
  reads: Schema.Literal("operations"),
  /** Where its knowledge comes from, whether it was checked on a real export: for a shared file. */
  description: CsvProfile.fields.description,
  separator: CsvProfile.fields.separator,
  encoding: CsvProfile.fields.encoding,
  skipRows: CsvProfile.fields.skipRows,
  headerRow: Schema.Boolean,
  dateFormat: DateFormat,
  /** Every other mark groups thousands, by three digits, in amounts, quantities and prices. */
  decimalMark: CsvProfile.fields.decimalMark,
  /** Which column holds which field of an operation; `null`, or left out, where none does. */
  columns: Schema.Struct({
    /** The day of the trade, as the broker dates the operation. */
    bookedOn: ColumnPlace,
    /** Its settlement day. */
    valueOn: MaybeColumn,
    /**
     * The words that say what each row is, mapped by `kinds`. `null`: every row is a purchase or a
     * sale, told by the sign of its quantity (positive bought, negative sold), as Degiro writes.
     */
    kind: MaybeColumn,
    isin: MaybeColumn,
    securityName: MaybeColumn,
    /** The currency the security is quoted in, an ISO 4217 code; the account's when `null`. */
    securityCurrency: MaybeColumn,
    quantity: MaybeColumn,
    unitPrice: MaybeColumn,
    /** Fees, or a dividend's withholding tax, whatever their sign. */
    fees: MaybeColumn,
    /** The cash the operation moved, fees included: its sign is the kind's (README). */
    amount: ColumnPlace,
    label: MaybeColumn,
    /** The broker's own reference for the row. */
    reference: MaybeColumn,
    /** The currency `amount` is written in, checked against the account's. */
    amountCurrency: MaybeColumn,
    /** The currency `fees` are written in, checked against the account's. */
    feesCurrency: MaybeColumn,
    /** The currency `unitPrice` is written in: another than the account's is read from `value`. */
    priceCurrency: MaybeColumn,
    /** What the trade was worth in the account's currency, fees aside (Degiro's `Value`). */
    value: MaybeColumn,
  }),
  /** The words of the kind column, compared trimmed, in any case, accents aside. */
  kinds: Schema.Array(KindWord).check(Schema.isMaxLength(MAX_KIND_WORDS)),
  /** Whether the broker makes `reference` unique to each row: the import then keys by it. */
  referenceUnique: Schema.Boolean,
});

export type OperationsProfile = typeof OperationsProfile.Type;

/** An import profile of operations, version 1 (#250's first): every column by its place. */
const OperationsProfileV1 = Schema.Struct({
  version: Schema.Literal(1),
  reads: Schema.Literal("operations"),
  separator: CsvProfile.fields.separator,
  encoding: CsvProfile.fields.encoding,
  skipRows: CsvProfile.fields.skipRows,
  headerRow: Schema.Boolean,
  dateFormat: DateFormat,
  decimalMark: CsvProfile.fields.decimalMark,
  columns: Schema.Struct({
    bookedOn: Column,
    valueOn: Schema.NullOr(Column),
    kind: Schema.NullOr(Column),
    isin: Schema.NullOr(Column),
    securityName: Schema.NullOr(Column),
    securityCurrency: Schema.NullOr(Column),
    quantity: Schema.NullOr(Column),
    unitPrice: Schema.NullOr(Column),
    fees: Schema.NullOr(Column),
    amount: Column,
    label: Schema.NullOr(Column),
    reference: Schema.NullOr(Column),
  }),
  kinds: Schema.Array(KindWord).check(Schema.isMaxLength(MAX_KIND_WORDS)),
  referenceUnique: Schema.Boolean,
});

/**
 * A profile of version 1, as saved before version 2, read as version 2: the same columns, by their
 * places, and none of the columns version 2 adds. Gousset writes version 2 only.
 */
const OperationsProfileFromV1 = OperationsProfileV1.pipe(
  Schema.decodeTo(OperationsProfile, {
    decode: SchemaGetter.transform((old) => ({
      ...old,
      version: 2 as const,
      columns: {
        ...old.columns,
        amountCurrency: null,
        feesCurrency: null,
        priceCurrency: null,
        value: null,
      },
    })),
    encode: SchemaGetter.forbidden(() => "Gousset writes an operations profile in version 2."),
  }),
);

/**
 * What an import profile's definition is: a statement's (`CsvProfile`) or a broker's operations'
 * (`OperationsProfile`, of version 2 or 1). An operations profile is tried first: a statement's
 * lacks its `reads`.
 */
export const CsvDefinition = Schema.Union([OperationsProfile, OperationsProfileFromV1, CsvProfile]);

export type CsvDefinition = typeof CsvDefinition.Type;

/** Whether a definition reads a broker's operations rather than an account's lines. */
export function readsOperations(definition: CsvDefinition): definition is OperationsProfile {
  return "reads" in definition;
}

/** Whether a column is found by its place, rather than by a name. */
export const isPlace = Schema.is(Column);

/**
 * The highest column an operations profile reads by its place: a header with fewer is another
 * file's. 0 when it finds every column by name.
 */
export function lastOperationColumn(profile: OperationsProfile): number {
  return Math.max(0, ...Object.values(profile.columns).filter(isPlace));
}
