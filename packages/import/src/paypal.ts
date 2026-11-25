import { Effect } from "effect";

import { invalidField, readAmount } from "./amount";
import type { AmountSyntax, FieldText } from "./amount";
import type { CsvCell, CsvRow } from "./csv-parse";
import { qifDay, readQifDate } from "./dates";
import type { DateOrder } from "./dates";
import { MalformedFile, MissingField } from "./errors";
import type { ReadError } from "./errors";
import type { OriginalAmount, StatementLine } from "./statement";
import { cleanValue } from "./text";

// PayPal's activity (#201; README, "PayPal's activity"): the CSV of PayPal's Activity Download
// report, read as the statement of a PayPal account. The report lets its user choose its columns,
// and names them in the account's language, so they are found by their names; its days and amounts
// are written as the account's country writes them, so they are read as the file shows them. Only
// the rows that moved the balance count: completed, and not a memo. A payment in another currency
// is taken from the balance by its conversion, which names nobody: the conversion is the line, and
// it takes the payment's name and amount.

/** What the reader needs of a row, and where some of it stands for an error to say. */
type Column =
  | "date"
  | "name"
  | "type"
  | "status"
  | "currency"
  | "net"
  | "transactionId"
  | "reference"
  | "balanceImpact";

type Language = "en" | "fr";

/**
 * Each column's names, lower case and without accents: English as PayPal documents its report,
 * French as an account in France names them (not documented publicly: a guess, README).
 */
const NAMES: ReadonlyArray<{ column: Column; language: Language; name: string }> = [
  { column: "date", language: "en", name: "date" },
  { column: "name", language: "en", name: "name" },
  { column: "name", language: "fr", name: "nom" },
  { column: "type", language: "en", name: "type" },
  { column: "status", language: "en", name: "status" },
  { column: "status", language: "fr", name: "etat" },
  { column: "status", language: "fr", name: "statut" },
  { column: "currency", language: "en", name: "currency" },
  { column: "currency", language: "fr", name: "devise" },
  { column: "net", language: "en", name: "net" },
  { column: "transactionId", language: "en", name: "transaction id" },
  { column: "transactionId", language: "fr", name: "numero de transaction" },
  { column: "transactionId", language: "fr", name: "n° de transaction" },
  { column: "transactionId", language: "fr", name: "id de transaction" },
  { column: "reference", language: "en", name: "reference txn id" },
  { column: "reference", language: "fr", name: "numero de transaction de reference" },
  { column: "reference", language: "fr", name: "n° de transaction de reference" },
  { column: "reference", language: "fr", name: "id de transaction de reference" },
  { column: "balanceImpact", language: "en", name: "balance impact" },
  { column: "balanceImpact", language: "fr", name: "impact sur le solde" },
];

/** The columns every export has (PayPal's mandatory ones), in the English the errors name them. */
const REQUIRED: ReadonlyArray<readonly [Column, string]> = [
  ["date", "Date"],
  ["name", "Name"],
  ["type", "Type"],
  ["status", "Status"],
  ["currency", "Currency"],
  ["net", "Net"],
  ["transactionId", "Transaction ID"],
];

/** The statuses of a row that is done, as each language writes `Completed`. */
const COMPLETED: ReadonlySet<string> = new Set(["completed", "termine", "terminee"]);

/** A row's balance impact when it moved no money: `Memo`. */
const MEMO = "memo";

/** A name or a value as the reader compares it: trimmed, lower case, accents and inner spaces gone. */
function plain(text: string): string {
  return cleanValue(text)
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

/** Where each column is, counted from 0, and the language of the export. */
type Columns = {
  readonly at: { readonly [column in Column]?: number };
  readonly language: Language;
};

/** The columns a header names, the first of each name; `missing`, the first required it lacks. */
function columnsOf(header: ReadonlyArray<string>): Columns & { readonly missing: string | null } {
  const at: { [column in Column]?: number } = {};
  let language: Language = "en";

  for (const [index, cell] of header.entries()) {
    const found = NAMES.find((each) => each.name === plain(cell));

    if (found === undefined || at[found.column] !== undefined) {
      continue;
    }

    at[found.column] = index;

    if (found.column === "transactionId") {
      language = found.language;
    }
  }

  const missing = REQUIRED.find(([column]) => at[column] === undefined);

  return { at, language, missing: missing?.[1] ?? null };
}

/**
 * Whether a header (as `normalizeHeader` keeps it: lower case, `;` between its cells) is PayPal's
 * activity: it names every column the report always has, in English or in French.
 */
export function isPaypalHeader(header: string): boolean {
  return columnsOf(header.split(";")).missing === null;
}

/** A row's cell at a column counted from 0, empty when the row is shorter. */
function cellOf(row: CsvRow, index: number | undefined): CsvCell {
  const at = index ?? -1;

  return row.cells[at] ?? { text: "", line: row.line, column: at + 1 };
}

function textOf(row: CsvRow, index: number | undefined): string {
  return index === undefined ? "" : cleanValue(cellOf(row, index).text);
}

/** A row as the reader keeps it, once it is known to have moved the balance. */
type Movement = {
  readonly row: CsvRow;
  readonly name: string;
  readonly type: string;
  readonly currency: string;
  readonly net: CsvCell;
  readonly id: string;
  readonly reference: string;
};

/** The rows that moved the balance: completed, and not a memo when the export says. */
function movementsOf(rows: ReadonlyArray<CsvRow>, { at }: Columns): Array<Movement> {
  return rows.flatMap((row) => {
    const completed = COMPLETED.has(plain(textOf(row, at.status)));
    const memo = plain(textOf(row, at.balanceImpact)) === MEMO;

    if (!completed || memo) {
      return [];
    }

    return [
      {
        row,
        name: textOf(row, at.name),
        type: textOf(row, at.type),
        currency: textOf(row, at.currency).toUpperCase(),
        net: cellOf(row, at.net),
        id: textOf(row, at.transactionId),
        reference: textOf(row, at.reference),
      },
    ];
  });
}

/**
 * Which of the two first numbers of the days is the day: the one a number above 12 says, otherwise
 * the language's habit (month first in PayPal's documented US format, day first in French).
 */
function dateOrderOf(days: ReadonlyArray<string>, language: Language): DateOrder {
  for (const day of days) {
    const read = readQifDate(day);

    if (read?.kind !== "numbers") {
      continue;
    }

    if (read.first > 12) {
      return "day-first";
    }

    if (read.second > 12) {
      return "month-first";
    }
  }

  return language === "fr" ? "day-first" : "month-first";
}

/**
 * The decimal mark of the amounts: the one an amount ends with before its cents, otherwise the
 * language's habit (a point in English, a comma in French).
 */
function syntaxOf(amounts: ReadonlyArray<string>, language: Language): AmountSyntax {
  for (const amount of amounts) {
    if (/,\d{1,2}$/.test(amount.trim())) {
      return "decimal-comma";
    }

    if (/\.\d{1,2}$/.test(amount.trim())) {
      return "decimal-point";
    }
  }

  return language === "fr" ? "decimal-comma" : "decimal-point";
}

function fieldOf(field: string, cell: CsvCell): FieldText {
  return { field, text: cleanValue(cell.text), line: cell.line, column: cell.column };
}

/** The account's currency, and whether rows in another are left out (no account chosen: not). */
export type PaypalCurrency = { readonly code: string; readonly checked: boolean };

type Reading = {
  readonly syntax: AmountSyntax;
  readonly order: DateOrder;
  readonly byId: ReadonlyMap<string, Movement>;
};

/** A movement's net amount, in minor units of its own currency. */
const netOf = (movement: Movement, syntax: AmountSyntax) => {
  const written = fieldOf("amount", movement.net);

  return written.text === ""
    ? Effect.fail(
        new MissingField({ line: written.line, column: movement.net.column, field: "amount" }),
      )
    : readAmount(written, movement.currency, syntax);
};

const lineOf = (movement: Movement, at: Columns["at"], reading: Reading) =>
  Effect.gen(function* () {
    const { row } = movement;
    const dateCell = cellOf(row, at.date);
    const written = fieldOf("bookedOn", dateCell);
    const date = readQifDate(written.text);
    const bookedOn = date === undefined ? undefined : qifDay(date, reading.order);

    if (bookedOn === undefined) {
      return yield* invalidField(written, "a date such as 10/03/2026 or 2026-10-03");
    }

    const amountMinor = yield* netOf(movement, reading.syntax);
    const paid = reading.byId.get(movement.reference);

    // A conversion of the account's currency for a payment in another, moving money the same way:
    // the payment's name and amount are what it was.
    const converted =
      paid !== undefined && paid.currency !== movement.currency
        ? { paid, amountMinor: yield* netOf(paid, reading.syntax) }
        : undefined;

    const original: OriginalAmount | undefined =
      converted !== undefined && Math.sign(converted.amountMinor) === Math.sign(amountMinor)
        ? { amountMinor: converted.amountMinor, currency: converted.paid.currency }
        : undefined;

    const name =
      movement.name === "" && original !== undefined ? (converted?.paid.name ?? "") : movement.name;

    const label = name === "" ? movement.type : name;

    const line: StatementLine = {
      bookedOn,
      valueOn: null,
      amountMinor,
      label,
      memo: label === movement.type || movement.type === "" ? null : movement.type,
      bankId: movement.id === "" ? null : movement.id,
      counterparty: null,
    };

    return original === undefined ? line : { ...line, original };
  });

/**
 * The lines of PayPal's activity, from its header row and the rows below it, in the file's order:
 * the rows that moved the balance in the account's currency (every currency when it is not
 * checked). Fails with `MalformedFile` when the header lacks a column the report always has.
 */
export const readPaypalRows = (
  header: CsvRow,
  rows: ReadonlyArray<CsvRow>,
  currency: PaypalCurrency,
): Effect.Effect<Array<StatementLine>, ReadError> =>
  Effect.gen(function* () {
    const columns = columnsOf(header.cells.map((cell) => cell.text));

    if (columns.missing !== null) {
      return yield* new MalformedFile({
        line: header.line,
        problem: `No column named ${columns.missing}: the file is not PayPal's activity, or that column was left out of it.`,
      });
    }

    const { at, language } = columns;
    const movements = movementsOf(rows, columns);

    const reading: Reading = {
      order: dateOrderOf(
        movements.map((movement) => textOf(movement.row, at.date)),
        language,
      ),
      syntax: syntaxOf(
        movements.map((movement) => movement.net.text),
        language,
      ),
      byId: new Map(
        movements.flatMap((movement): Array<[string, Movement]> =>
          movement.id === "" ? [] : [[movement.id, movement]],
        ),
      ),
    };

    const kept = currency.checked
      ? movements.filter((movement) => movement.currency === currency.code)
      : movements;

    return yield* Effect.forEach(kept, (movement) => lineOf(movement, at, reading));
  });
