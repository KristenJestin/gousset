import { Effect, Exit } from "effect";

import { readAmount } from "./amount";
import type { AmountSyntax } from "./amount";
import { normalizeHeader } from "./csv";
import { dayReader } from "./csv-profile";
import type { CsvProfile } from "./csv-profile";
import { decodeDetected, parseRows } from "./csv-parse";
import type { CsvRow, ParseLimit } from "./csv-parse";
import { NotAStatement } from "./errors";
import type { ReadError } from "./errors";
import { cleanValue } from "./text";

// Detection reads a CSV file it has no profile for and proposes one, for the import screen to show
// over a preview of the file, the user correcting what it got wrong. Nothing here is certain: what
// the file does not decide is named in `unsure`.

/** A part of a proposed profile the file did not decide, which the import screen should ask. */
export type CsvUnsure =
  /** Every date reads both day first and month first (`03/04/2026`): day first was taken. */
  | "dateFormat"
  /** No amount says which mark is the decimal one (`1,234`, `12`): the separator's habit was taken. */
  | "decimalMark"
  /** Several columns hold amounts and no header says which one, or which is the debit. */
  | "amount";

export type CsvProposal = {
  profile: CsvProfile;
  /** The file's header row, normalised (`normalizeHeader`), to keep with the profile; or `null`. */
  header: string | null;
  unsure: ReadonlyArray<CsvUnsure>;
};

const SEPARATORS = [";", ",", "\t", "|"] as const;

type Separator = (typeof SEPARATORS)[number];

/** Day first before month first: where both read every date, the first one fitting is taken. */
const DATE_FORMATS = ["/", ".", "-"].flatMap((mark) => [
  `DD${mark}MM${mark}YYYY`,
  `MM${mark}DD${mark}YYYY`,
  `DD${mark}MM${mark}YY`,
  `MM${mark}DD${mark}YY`,
  `YYYY${mark}MM${mark}DD`,
]);

const DAY_READERS = DATE_FORMATS.map((format) => ({ format, read: dayReader(format) }));

// The words of a header that say what a column holds, in the languages banks export in. Matched
// against whole words, accents and case left out.
const BOOKED = ["booking", "booked", "posting", "posted", "comptable", "buchung", "buchungstag"];
const VALUE = ["valeur", "value", "valuta", "wertstellung"];
const DEBIT = ["debit", "debits", "withdrawal", "withdrawals", "soll", "ausgang"];
const CREDIT = ["credit", "credits", "deposit", "deposits", "haben", "eingang"];
const AMOUNT = ["montant", "amount", "betrag", "importe", "somme"];
const BALANCE = ["solde", "balance", "saldo"];

const LABEL = [
  "libelle",
  "label",
  "description",
  "payee",
  "beneficiaire",
  "wording",
  "verwendungszweck",
  "narrative",
  "intitule",
];

const MEMO = [
  "memo",
  "note",
  "notes",
  "detail",
  "details",
  "commentaire",
  "comment",
  "information",
];

const REFERENCE = ["reference", "ref", "id", "fitid"];

// Three capital letters may be a type (`VIR`, `PRL`, `CHQ`) as well as a currency: only a header
// saying so makes such a column the currency's, which `readCsv` checks every line against.
const CURRENCY = ["devise", "currency", "ccy", "wahrung", "monnaie"];

/**
 * What detection reads from the top of the file, under each separator: 200 rows, within 2,000 lines
 * and a mebibyte. Enough to tell the table, its header and its columns, and little enough that a
 * large file, or one of blank lines, costs no more than a small one.
 */
const SAMPLE: ParseLimit = { rows: 200, lines: 2000, characters: 1024 * 1024 };

type Kind = "date" | "amount" | "currency" | "text";

type Column = {
  column: number;
  kind: Kind;
  values: Array<string>;
  words: Array<string>;
  /** The date formats that read every value, for a date column. */
  formats: Array<string>;
  /** The decimal marks with which every value reads as an amount, for an amount column. */
  marks: Array<"." | ",">;
};

/** The rows of the text, as one separator cuts them, from the first row of the widest table. */
type Table = { separator: Separator; rows: Array<CsvRow>; width: number };

function tableOf(text: string, separator: Separator): Table | undefined {
  const parsed = Effect.runSyncExit(parseRows(text, separator, 1, SAMPLE));

  if (Exit.isFailure(parsed)) {
    return undefined;
  }

  const rows = parsed.value;
  const counts = new Map<number, number>();

  for (const row of rows) {
    counts.set(row.cells.length, (counts.get(row.cells.length) ?? 0) + 1);
  }

  let width = 0;
  let most = 0;

  for (const [count, times] of counts) {
    if (times > most || (times === most && count > width)) {
      width = count;
      most = times;
    }
  }

  if (width < 2) {
    return undefined;
  }

  const first = rows.findIndex((row) => row.cells.length === width);

  return {
    separator,
    rows: rows.slice(first).filter((row) => row.cells.length === width),
    width,
  };
}

/** The table most rows agree on; on a tie, the widest, then the first separator. */
function bestTable(text: string): Table | undefined {
  let best: Table | undefined;

  for (const separator of SEPARATORS) {
    const table = tableOf(text, separator);

    if (
      table !== undefined &&
      (best === undefined ||
        table.rows.length > best.rows.length ||
        (table.rows.length === best.rows.length && table.width > best.width))
    ) {
      best = table;
    }
  }

  return best;
}

function wordsOf(text: string): Array<string> {
  return cleanValue(text)
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

function says(column: Column, words: ReadonlyArray<string>): boolean {
  return column.words.some((word) => words.includes(word));
}

const SYNTAX = { ".": "decimal-point", ",": "decimal-comma" } satisfies {
  [mark in "." | ","]: AmountSyntax;
};

function readsAsAmount(text: string, mark: "." | ","): boolean {
  // Four minor digits: a file's decimals are counted by the reader, which knows the currency.
  const read = readAmount({ field: "amount", text, line: 1 }, "CLF", SYNTAX[mark]);

  return Exit.isSuccess(Effect.runSyncExit(read));
}

function kindOf(
  values: ReadonlyArray<string>,
  formats: ReadonlyArray<string>,
  marks: ReadonlyArray<string>,
): Kind {
  if (values.length === 0) {
    return "text";
  }

  if (formats.length > 0) {
    return "date";
  }

  // Digits alone may be a reference: an amount column writes decimals or a sign somewhere.
  if (marks.length > 0 && values.some((value) => /[.,]|^[+-]/.test(value))) {
    return "amount";
  }

  return values.every((value) => /^[A-Z]{3}$/.test(value)) ? "currency" : "text";
}

function columnsOf(
  body: ReadonlyArray<CsvRow>,
  header: CsvRow | undefined,
  width: number,
): Array<Column> {
  return Array.from({ length: width }, (_, index) => {
    const values = body.flatMap((row) => {
      const text = cleanValue(row.cells[index]?.text ?? "");

      return text === "" ? [] : [text];
    });

    const formats = DAY_READERS.flatMap(({ format, read }) =>
      values.length > 0 && values.every((value) => read(value) !== undefined) ? [format] : [],
    );

    // Every mark reads an empty column: it holds no amount that says otherwise.
    const marks = ([".", ","] as const).filter((mark) =>
      values.every((value) => readsAsAmount(value, mark)),
    );

    const words = wordsOf(header?.cells[index]?.text ?? "");

    // A header saying Debit or Credit makes an amount column of what reads as one, empty in the
    // sample or in whole units: taken for a text, an unsigned debit beside it would read as money in.
    const sided = words.some((word) => DEBIT.includes(word) || CREDIT.includes(word));

    return {
      column: index + 1,
      kind:
        sided && marks.length > 0 && formats.length === 0
          ? "amount"
          : kindOf(values, formats, marks),
      values,
      words,
      formats,
      marks,
    };
  });
}

/** Whether any value of the column is no zero: an amount written there. */
function holdsAmount(row: CsvRow, column: Column): boolean {
  return /[1-9]/.test(row.cells[column.column - 1]?.text ?? "");
}

type Layout = { amount: CsvProfile["columns"]["amount"]; used: Array<Column>; unsure: boolean };

function amountLayout(
  columns: ReadonlyArray<Column>,
  body: ReadonlyArray<CsvRow>,
): Layout | undefined {
  const amounts = columns.filter((column) => column.kind === "amount" && !says(column, BALANCE));
  const debit = amounts.find((column) => says(column, DEBIT) && !says(column, CREDIT));
  const credit = amounts.find((column) => says(column, CREDIT) && !says(column, DEBIT));

  if (debit !== undefined && credit !== undefined) {
    return {
      amount: { kind: "debit-credit", debit: debit.column, credit: credit.column },
      used: [debit, credit],
      unsure: false,
    };
  }

  const [first, second] = amounts;

  if (first === undefined) {
    return undefined;
  }

  // A header naming one side alone, or both at once (`Débit/Crédit`), says the file has a
  // direction that what follows can only guess.
  const sided = amounts.some((column) => says(column, DEBIT) || says(column, CREDIT));
  const named = amounts.filter((column) => says(column, AMOUNT));

  const apart =
    amounts.length === 2 &&
    second !== undefined &&
    named.length === 0 &&
    body.every((row) => !(holdsAmount(row, first) && holdsAmount(row, second)));

  if (apart) {
    const negative = (column: Column) => column.values.every((value) => value.startsWith("-"));
    const out = negative(second) && !negative(first) ? second : first;
    const into = out === first ? second : first;

    return {
      amount: { kind: "debit-credit", debit: out.column, credit: into.column },
      used: [out, into],
      unsure: sided || negative(first) === negative(second),
    };
  }

  const [signed = first] = named;

  return {
    amount: { kind: "signed", column: signed.column },
    used: [signed],
    unsure: sided || named.length > 1 || (named.length === 0 && amounts.length > 1),
  };
}

function averageLength(column: Column): number {
  const total = column.values.reduce((sum, value) => sum + value.length, 0);

  return column.values.length === 0 ? 0 : total / column.values.length;
}

/**
 * Proposes an import profile for a CSV file: its encoding (UTF-8 when the bytes are, Windows-1252
 * otherwise), the separator most rows agree on, the lines before the table, whether its first row
 * is a header, the columns of dates, amounts (one signed column, or a debit and a credit), label,
 * memo, the bank's id and the currency, and how dates and amounts are written. A header's words
 * (`Libellé`, `Date de valeur`, `Debit`, `Transaction ID`) say which column is which; without one,
 * the first date column is the booking date and the longest text the label.
 *
 * Only the top of the file is read (`SAMPLE`). Fails with `NotAStatement` when no table with a
 * date, an amount and a text column for the label is found: the user then picks every column from
 * the preview.
 */
export const detectCsvProfile = (bytes: Uint8Array): Effect.Effect<CsvProposal, ReadError> =>
  Effect.gen(function* () {
    const { text, encoding } = yield* decodeDetected(bytes);
    const table = bestTable(text);
    const notCsv = new NotAStatement({ format: "csv" });

    if (table === undefined) {
      return yield* notCsv;
    }

    const [firstRow, ...rest] = table.rows;

    if (firstRow === undefined) {
      return yield* notCsv;
    }

    const headerRow = !firstRow.cells.some((cell) =>
      DAY_READERS.some(({ read }) => read(cleanValue(cell.text)) !== undefined),
    );

    const body = headerRow ? rest : table.rows;
    const columns = columnsOf(body, headerRow ? firstRow : undefined, table.width);
    const dates = columns.filter((column) => column.kind === "date");
    const value = dates.find((column) => says(column, VALUE));
    const others = dates.filter((column) => column !== value);
    const booked = others.find((column) => says(column, BOOKED)) ?? others[0] ?? value;
    const valueOn = booked === value ? undefined : value;
    const layout = amountLayout(columns, body);

    if (booked === undefined || layout === undefined) {
      return yield* notCsv;
    }

    const formats = booked.formats.filter(
      (format) => valueOn === undefined || valueOn.formats.includes(format),
    );

    const [dateFormat = booked.formats[0] ?? "DD/MM/YYYY"] = formats;

    const marks = ([".", ","] as const).filter((mark) =>
      layout.used.every((column) => column.marks.includes(mark)),
    );

    const habit = table.separator === "," || table.separator === "|" ? "." : ",";
    const decimalMark = (marks.length === 1 ? marks[0] : undefined) ?? habit;
    const taken = new Set([booked, valueOn, ...layout.used]);
    const texts = columns.filter((column) => column.kind === "text" && !taken.has(column));
    const bankId = texts.find((column) => says(column, REFERENCE));
    const memo = texts.find((column) => column !== bankId && says(column, MEMO));
    const free = texts.filter((column) => column !== bankId && column !== memo);

    const label =
      free.find((column) => says(column, LABEL)) ??
      free.reduce<Column | undefined>(
        (longest, column) =>
          longest === undefined || averageLength(column) > averageLength(longest)
            ? column
            : longest,
        undefined,
      );

    if (label === undefined) {
      return yield* notCsv;
    }

    const currency = columns.find((column) => column.kind === "currency" && says(column, CURRENCY));
    const unsure: Array<CsvUnsure> = [];

    if (formats.length !== 1) {
      unsure.push("dateFormat");
    }

    if (marks.length !== 1) {
      unsure.push("decimalMark");
    }

    if (layout.unsure) {
      unsure.push("amount");
    }

    return {
      profile: {
        version: 1,
        separator: table.separator,
        encoding,
        skipRows: firstRow.line - 1,
        headerRow,
        dateFormat,
        decimalMark,
        columns: {
          bookedOn: booked.column,
          valueOn: valueOn?.column ?? null,
          amount: layout.amount,
          label: label.column,
          memo: memo?.column ?? null,
          bankId: bankId?.column ?? null,
          currency: currency?.column ?? null,
        },
      },
      header: headerRow ? normalizeHeader(firstRow.cells.map((cell) => cell.text)) : null,
      unsure,
    };
  });
