import { isKnownCurrency } from "@gousset/currency";
import { Effect } from "effect";

import { invalidField, minorDigits, readAmount, readDecimal } from "./amount";
import type { FieldText } from "./amount";
import { cellAt, csvFile, currencyOf, readRows, SAMPLE } from "./csv";
import type { CsvFile } from "./csv";
import { dateExample, dayReader } from "./csv-profile";
import type { DayReader } from "./csv-profile";
import type { CsvRow, ParseLimit } from "./csv-parse";
import { MalformedFile, MissingField, UnsupportedContent } from "./errors";
import type { InvalidField, ReadError } from "./errors";
import { findsColumnsByName, placesIn, plainName } from "./operations-columns";
import type { OperationField, OperationPlaces } from "./operations-columns";
import { lastOperationColumn } from "./operations-profile";
import type { OperationKind, OperationsProfile } from "./operations-profile";
import { cleanValue, quote } from "./text";

// A broker's operations (README, "Brokers' operations"): a CSV export read through an operations
// profile into the operations it holds, each a purchase, a sale, a dividend, a fee, a deposit or a
// withdrawal, with the cash it moved. Nothing is guessed: a row whose kind the profile does not
// name, or that lacks what its kind needs, is refused at its line and column.

/** An operation as a broker's file states it, in the file's order. */
export type OperationRow = {
  /** The file's line its row starts on, counted from 1. */
  readonly line: number;
  readonly kind: OperationKind;
  /** `YYYY-MM-DD`: the day of the trade, as the broker dates the operation. */
  readonly bookedOn: string;
  /** `YYYY-MM-DD` or `null`: its settlement day. */
  readonly valueOn: string | null;
  /**
   * The cash it moved, in minor units of the account's currency: negative for a purchase, a fee
   * and a withdrawal, positive for the others, never zero. Read from the file's digits.
   */
  readonly amountMinor: number;
  /** Upper case, its check digit checked: a purchase's, a sale's and a dividend's; a fee's maybe. */
  readonly isin: string | null;
  readonly securityName: string | null;
  /** The ISO 4217 code the security is quoted in, when the file says. */
  readonly securityCurrency: string | null;
  /** A purchase's and a sale's, from zero: exact text with a point (`0.0347`). */
  readonly quantity: string | null;
  /** A purchase's and a sale's, in the account's currency: exact text with a point. */
  readonly unitPrice: string | null;
  /** Fees, or a dividend's withholding tax, in minor units, from 0. */
  readonly feesMinor: number;
  /** The broker's text for the row. */
  readonly label: string | null;
  /** The broker's own reference for the row. */
  readonly reference: string | null;
  /** Whether the profile makes `reference` unique to the row: the import keys by it then. */
  readonly referenceUnique: boolean;
};

/** A broker's file read: its operations, in the account's currency. */
export type Operations = {
  readonly currency: string;
  readonly operations: ReadonlyArray<OperationRow>;
};

/** The kinds that take money out of the account; the others bring it in. */
const OUT: ReadonlySet<OperationKind> = new Set(["purchase", "fee", "withdrawal"]);

const TRADES: ReadonlySet<OperationKind> = new Set(["purchase", "sale"]);

/** The kinds that name their security; a fee may, a deposit and a withdrawal never. */
const NAMED: ReadonlySet<OperationKind> = new Set(["purchase", "sale", "dividend"]);

const CASH: ReadonlySet<OperationKind> = new Set(["deposit", "withdrawal"]);

/** The account's currency, and whether the file's currencies are checked against it. */
type TableCurrency = { readonly code: string; readonly checked: boolean };

type Reading = {
  readonly places: OperationPlaces;
  /** The kind column's words, as compared (`plainName`), and the kinds they name. */
  readonly words: ReadonlyMap<string, OperationKind>;
  /** A few of the words as the profile writes them, for an error to name. */
  readonly named: ReadonlyArray<string>;
  readonly syntax: "decimal-point" | "decimal-comma";
  readonly read: DayReader;
  readonly dateFormat: string;
  readonly currency: TableCurrency;
  readonly referenceUnique: boolean;
};

/** A field's text at its column, or `undefined` when the profile names no column for it. */
function fieldAt(row: CsvRow, field: OperationField, reading: Reading): FieldText | undefined {
  const column = reading.places[field];

  if (column === undefined) {
    return undefined;
  }

  const cell = cellAt(row, column);

  return { field, text: cleanValue(cell.text), line: cell.line, column: cell.column };
}

/** A field's text, `null` when the profile names no column or the row leaves it empty. */
function textAt(row: CsvRow, field: OperationField, reading: Reading): string | null {
  const text = fieldAt(row, field, reading)?.text ?? "";

  return text === "" ? null : text;
}

/** A field the row's kind needs and it lacks, at its column when the profile names one. */
function missing(row: CsvRow, field: OperationField, reading: Reading): MissingField {
  const column = reading.places[field];

  return column === undefined
    ? new MissingField({ line: row.line, field })
    : new MissingField({ line: cellAt(row, column).line, column, field });
}

/** A field that holds something, or `MissingField`. */
function filled(
  row: CsvRow,
  field: OperationField,
  reading: Reading,
): Effect.Effect<FieldText, MissingField> {
  const written = fieldAt(row, field, reading);

  return written === undefined || written.text === ""
    ? Effect.fail(missing(row, field, reading))
    : Effect.succeed(written);
}

function dayOf(written: FieldText, reading: Reading): Effect.Effect<string, InvalidField> {
  const day = reading.read(written.text);

  return day === undefined
    ? Effect.fail(
        invalidField(
          written,
          `a date written ${reading.dateFormat}, such as ${dateExample(reading.dateFormat)}`,
        ),
      )
    : Effect.succeed(day);
}

/** A currency the file writes beside an amount: another than the account's is refused. */
function checkCurrency(
  row: CsvRow,
  field: "amountCurrency" | "feesCurrency",
  reading: Reading,
): Effect.Effect<void, UnsupportedContent> {
  const written = fieldAt(row, field, reading);
  const { code, checked } = reading.currency;

  if (!checked || written === undefined || written.text === "") {
    return Effect.void;
  }

  return written.text.toUpperCase() === code
    ? Effect.void
    : Effect.fail(
        new UnsupportedContent({
          line: written.line,
          column: written.column ?? 1,
          problem: `An operation in ${quote(written.text)}, in a file read for an account in ${code}: Gousset converts no currency.`,
        }),
      );
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** The check digit of an ISIN's first eleven characters (ISO 6166: Luhn over letters as numbers). */
function isinCheckDigit(rest: string): number {
  const digits = rest
    .split("")
    .map((character) => Number.parseInt(character, 36).toString())
    .join("");

  let sum = 0;

  for (let at = digits.length - 1, doubled = true; at >= 0; at -= 1, doubled = !doubled) {
    const digit = Number(digits.charAt(at)) * (doubled ? 2 : 1);

    sum += digit > 9 ? digit - 9 : digit;
  }

  return (10 - (sum % 10)) % 10;
}

/** An ISIN as written, in any case and with spaces: upper case without them, its check digit held. */
function isinOf(written: FieldText): Effect.Effect<string, InvalidField> {
  const isin = written.text.replaceAll(/\s+/g, "").toUpperCase();

  return ISIN.test(isin) && Number(isin.charAt(11)) === isinCheckDigit(isin.slice(0, 11))
    ? Effect.succeed(isin)
    : Effect.fail(
        invalidField(written, "an ISIN: two letters, nine letters or digits, a check digit"),
      );
}

/** A quantity as written, whatever its sign, which only says a sale where no column names kinds. */
const quantityOf = (row: CsvRow, reading: Reading) =>
  Effect.gen(function* () {
    const written = yield* filled(row, "quantity", reading);
    const quantity = yield* readDecimal(written, reading.syntax);

    if (quantity.text === "0") {
      return yield* invalidField(written, "a quantity that is not zero");
    }

    return quantity;
  });

/** What the row is: the profile's word for it, or the sign of its quantity when it names none. */
const kindOf = (row: CsvRow, reading: Reading): Effect.Effect<OperationKind, ReadError> =>
  Effect.gen(function* () {
    if (reading.places.kind === undefined) {
      const quantity = yield* quantityOf(row, reading);

      return quantity.negative ? "sale" : "purchase";
    }

    const written = yield* filled(row, "kind", reading);
    const kind = reading.words.get(plainName(written.text));

    if (kind === undefined) {
      const words = reading.named.map(quote).join(", ");

      return yield* invalidField(
        written,
        words === "" ? "a word the profile maps to a kind of operation" : `one of ${words}`,
      );
    }

    return kind;
  });

const ONE = 10n ** 10n;

/** A decimal's text (`12.5`) scaled by 10^10. */
function scaled(text: string): bigint {
  const [whole = "0", fraction = ""] = text.split(".");

  return BigInt(whole) * ONE + BigInt(fraction.padEnd(10, "0"));
}

/** A value scaled by 10^10, as text with a point and no trailing zero. */
function decimalText(value: bigint): string {
  const fraction = (value % ONE).toString().padStart(10, "0").replace(/0+$/, "");

  return `${(value / ONE).toString()}${fraction === "" ? "" : `.${fraction}`}`;
}

/**
 * What one unit cost in the account's currency: the price as written, or, for a price written in
 * another currency (Degiro's foreign shares), what the trade was worth in the account's (`value`)
 * divided by the quantity, to 10 decimals, rounded half up.
 */
const unitPriceOf = (row: CsvRow, quantity: string, reading: Reading) =>
  Effect.gen(function* () {
    const priced = fieldAt(row, "priceCurrency", reading);
    const { code, checked } = reading.currency;

    if (
      checked &&
      priced !== undefined &&
      priced.text !== "" &&
      priced.text.toUpperCase() !== code
    ) {
      const written = fieldAt(row, "value", reading);

      if (written === undefined || written.text === "") {
        return yield* new UnsupportedContent({
          line: priced.line,
          column: priced.column ?? 1,
          problem: `A price in ${quote(priced.text)}, in a file read for an account in ${code}, and no value in ${code} to read it from.`,
        });
      }

      const value = BigInt(Math.abs(yield* readAmount(written, code, reading.syntax)));
      const top = value * ONE * ONE * 2n;
      const bottom = 10n ** BigInt(minorDigits(code)) * scaled(quantity);

      return decimalText((top / bottom + 1n) / 2n);
    }

    const written = yield* filled(row, "unitPrice", reading);
    const price = yield* readDecimal(written, reading.syntax);

    if (price.negative) {
      return yield* invalidField(written, "a price without a minus sign");
    }

    return price.text;
  });

/**
 * The security's currency, as an ISO 4217 code; `null` for the account's. A text that is no such
 * code (`GBX`, pence, which a broker writes for a London price) is held in the account's currency,
 * as a file with no such column is: its price is then read from the trade's value (`unitPriceOf`),
 * and the whole file is never refused for it.
 */
function securityCurrencyOf(row: CsvRow, reading: Reading): Effect.Effect<string | null> {
  const written = fieldAt(row, "securityCurrency", reading);
  const code = written?.text.toUpperCase() ?? "";

  return Effect.succeed(isKnownCurrency(code) ? code : null);
}

const readOperation = (row: CsvRow, reading: Reading): Effect.Effect<OperationRow, ReadError> =>
  Effect.gen(function* () {
    const bookedOn = yield* dayOf(yield* filled(row, "bookedOn", reading), reading);
    const valueField = fieldAt(row, "valueOn", reading);

    const valueOn =
      valueField === undefined || valueField.text === "" ? null : yield* dayOf(valueField, reading);

    yield* checkCurrency(row, "amountCurrency", reading);
    yield* checkCurrency(row, "feesCurrency", reading);

    const kind = yield* kindOf(row, reading);
    const { code } = reading.currency;
    const amountField = yield* filled(row, "amount", reading);
    const written = yield* readAmount(amountField, code, reading.syntax);

    if (written === 0) {
      return yield* invalidField(amountField, "an amount that is not zero");
    }

    // The kind gives the sign: a broker may write a purchase's amount with its minus or without.
    // A minus on an operation that brings money in says the opposite of its kind.
    if (written < 0 && !OUT.has(kind)) {
      return yield* invalidField(amountField, `an amount without a minus sign, as a ${kind} has`);
    }

    const feesField = fieldAt(row, "fees", reading);

    const feesMinor =
      feesField === undefined || feesField.text === ""
        ? 0
        : Math.abs(yield* readAmount(feesField, code, reading.syntax));

    const isinField = CASH.has(kind) ? undefined : fieldAt(row, "isin", reading);

    const isin = isinField === undefined || isinField.text === "" ? null : yield* isinOf(isinField);

    if (isin === null && NAMED.has(kind)) {
      return yield* missing(row, "isin", reading);
    }

    const trade = TRADES.has(kind);
    const quantity = trade ? (yield* quantityOf(row, reading)).text : null;
    const unitPrice = quantity === null ? null : yield* unitPriceOf(row, quantity, reading);

    return {
      line: row.line,
      kind,
      bookedOn,
      valueOn,
      amountMinor: OUT.has(kind) ? -Math.abs(written) : written,
      isin,
      securityName: isin === null ? null : textAt(row, "securityName", reading),
      securityCurrency: isin === null ? null : yield* securityCurrencyOf(row, reading),
      quantity,
      unitPrice,
      feesMinor,
      label: textAt(row, "label", reading),
      reference: textAt(row, "reference", reading),
      referenceUnique: reading.referenceUnique,
    };
  });

/** Where each field stands, as the profile says: at a place, or found by a name in the header row. */
const placesFor = (
  profile: OperationsProfile,
  header: CsvRow | undefined,
  line: number,
): Effect.Effect<OperationPlaces, MalformedFile> => {
  if (findsColumnsByName(profile) && header === undefined) {
    return Effect.fail(
      new MalformedFile({
        line,
        problem:
          "No header row: the profile finds columns by their names, which a header row gives.",
      }),
    );
  }

  if (profile.headerRow && header !== undefined) {
    const needed = lastOperationColumn(profile);

    if (header.cells.length < needed) {
      return Effect.fail(
        new MalformedFile({
          line: header.line,
          problem: `Column ${String(needed)} is past the header's last (column ${String(header.cells.length)}): the file may be another broker's, or its separator another.`,
        }),
      );
    }
  }

  const found = placesIn(
    profile,
    (header?.cells ?? []).map((cell) => cell.text),
  );

  return found.missing === null || header === undefined
    ? Effect.succeed(found.places)
    : Effect.fail(
        new MalformedFile({
          line: header.line,
          problem: `No column ${quote(found.missing)}: the file is another broker's export, or its columns are named in another language.`,
        }),
      );
};

/** The operations of the file, or of its top with `limit`. */
const readTable = (
  file: CsvFile,
  profile: OperationsProfile,
  currency: TableCurrency,
  limit?: ParseLimit,
): Effect.Effect<Operations, ReadError> =>
  Effect.gen(function* () {
    const { rows, line } = yield* readRows(file, profile, limit);
    const [header, ...data] = rows;

    if (profile.headerRow && header === undefined) {
      return yield* new MalformedFile({
        line,
        problem: "No header row: the file holds nothing past the lines the profile skips.",
      });
    }

    const places = yield* placesFor(profile, profile.headerRow ? header : undefined, line);
    const words = new Map<string, OperationKind>();

    for (const { word, kind } of profile.kinds) {
      if (!words.has(plainName(word))) {
        words.set(plainName(word), kind);
      }
    }

    const reading: Reading = {
      places,
      words,
      named: profile.kinds.slice(0, 6).map((each) => each.word),
      syntax: profile.decimalMark === "." ? "decimal-point" : "decimal-comma",
      read: dayReader(profile.dateFormat),
      dateFormat: profile.dateFormat,
      currency,
      referenceUnique: profile.referenceUnique,
    };

    const body = profile.headerRow || header === undefined ? data : [header, ...data];

    return {
      currency: currency.code,
      operations: yield* Effect.forEach(body, (row) => readOperation(row, reading)),
    };
  });

/**
 * Reads a broker's CSV export with an operations profile: its operations, in `options.currency`,
 * the account's, in the file's order. Every error names the line, and the column where one is at
 * fault: a value that cannot be read (`InvalidField`, `field` being the profile's: `bookedOn`,
 * `kind`, `isin`, `quantity`, `unitPrice`, `amount`, `fees`), a word of the kind column the
 * profile does not map (`InvalidField`, `kind`), a row without what its kind needs (`MissingField`),
 * an amount in another currency than the account's (`UnsupportedContent`), a header that is not
 * the broker's or has fewer columns than the profile reads (`MalformedFile`).
 */
export const readOperations = (
  bytes: Uint8Array,
  profile: OperationsProfile,
  options: { readonly currency: string },
): Effect.Effect<Operations, ReadError> =>
  Effect.flatMap(currencyOf(options.currency), (code) =>
    readTable(csvFile(bytes), profile, { code, checked: true }),
  );

/**
 * Reads the top of a file with an operations profile, as `readOperations` reads it whole: its
 * first 50 rows past the header, within 64 KiB, as `testReadCsv` does for a statement. With no
 * `currency`, amounts are read with up to four decimals (`CLF`) and no currency is checked.
 */
export const testReadOperations = (
  file: CsvFile,
  profile: OperationsProfile,
  currency: string | null,
): Effect.Effect<Operations, ReadError> =>
  currency === null
    ? readTable(file, profile, { code: "CLF", checked: false }, SAMPLE)
    : Effect.flatMap(currencyOf(currency), (code) =>
        readTable(file, profile, { code, checked: true }, SAMPLE),
      );
