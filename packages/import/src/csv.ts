import { Effect } from "effect";
import type { Exit } from "effect";

import { invalidField, readAmount } from "./amount";
import type { AmountSyntax, FieldText } from "./amount";
import { isLayoutHeader } from "./brokers";
import { dateExample, dayReader, lastColumn } from "./csv-profile";
import type { CsvProfile, DayReader } from "./csv-profile";
import { readsOperations } from "./operations-profile";
import type { CsvDefinition } from "./operations-profile";
import { decodeCsv, parseRows, skipLines } from "./csv-parse";
import type { CsvCell, CsvEncoding, CsvRow, ParseLimit } from "./csv-parse";
import { InvalidOption, MalformedFile, MissingField, UnsupportedContent } from "./errors";
import type { InvalidField, ReadError } from "./errors";
import { isPaypalHeader, readPaypalRows } from "./paypal";
import type { Statement, StatementLine } from "./statement";
import { cleanValue, excerpt, quote } from "./text";

// CSV: a table whose columns each bank chooses, read through an import profile (`CsvProfile`)
// that says which column holds which field, and how dates and amounts are written.

export type CsvOptions = {
  /**
   * The ISO 4217 code of the account the file goes into (`EUR`, `eur` taken as `EUR`): a CSV file
   * names none, or one per line, checked against it. Anything else is refused with `InvalidOption`.
   */
  currency: string;
};

/** The cell of a row at `column`; a row shorter than that has it empty, on the row's last line. */
export function cellAt(row: CsvRow, column: number): CsvCell {
  return row.cells[column - 1] ?? { text: "", line: row.cells.at(-1)?.line ?? row.line, column };
}

function fieldText(field: string, cell: CsvCell): FieldText {
  return { field, text: cleanValue(cell.text), line: cell.line, column: cell.column };
}

/** A cell's text as a line gives it; `null` when the profile names no column or it is empty. */
function optionalText(row: CsvRow, column: number | null): string | null {
  const text = column === null ? "" : cleanValue(cellAt(row, column).text);

  return text === "" ? null : text;
}

function readDay(
  row: CsvRow,
  field: string,
  column: number,
  read: DayReader,
  format: string,
): Effect.Effect<string | null, InvalidField> {
  const written = fieldText(field, cellAt(row, column));

  if (written.text === "") {
    return Effect.succeed(null);
  }

  const day = read(written.text);

  if (day === undefined) {
    return Effect.fail(
      invalidField(written, `a date written ${format}, such as ${dateExample(format)}`),
    );
  }

  return Effect.succeed(day);
}

/** The currency a table is read in, and whether a currency column's lines are checked against it. */
type TableCurrency = { readonly code: string; readonly checked: boolean };

type Reading = {
  profile: CsvProfile;
  currency: string;
  /** Whether a line's currency is checked against `currency`. */
  checkCurrency: boolean;
  syntax: AmountSyntax;
  read: DayReader;
};

/** A debit and its sign as the file writes it, for the check that every debit is signed alike. */
type Debit = { line: number; column: number; negative: boolean };

type Read = { line: StatementLine; debit: Debit | null };

/** The amount of a line: from its one column, or from its debit or its credit. */
const readLineAmount = (row: CsvRow, reading: Reading) =>
  Effect.gen(function* () {
    const { amount } = reading.profile.columns;

    if (amount.kind === "signed") {
      const written = fieldText("amount", cellAt(row, amount.column));

      if (written.text === "") {
        return yield* new MissingField({
          line: written.line,
          column: amount.column,
          field: "amount",
        });
      }

      return {
        amountMinor: yield* readAmount(written, reading.currency, reading.syntax),
        debit: null,
      };
    }

    const debitText = fieldText("debit", cellAt(row, amount.debit));
    const creditText = fieldText("credit", cellAt(row, amount.credit));

    if (debitText.text === "" && creditText.text === "") {
      return yield* new MissingField({
        line: debitText.line,
        column: amount.debit,
        field: "debit",
      });
    }

    const debit =
      debitText.text === "" ? 0 : yield* readAmount(debitText, reading.currency, reading.syntax);

    const credit =
      creditText.text === "" ? 0 : yield* readAmount(creditText, reading.currency, reading.syntax);

    if (credit < 0) {
      return yield* invalidField(creditText, "a credit without a minus sign: money that came in");
    }

    if (debit !== 0 && credit !== 0) {
      return yield* new UnsupportedContent({
        line: creditText.line,
        column: amount.credit,
        problem: `A debit (column ${String(amount.debit)}) and a credit (column ${String(amount.credit)}) on one line: a line fills one of them.`,
      });
    }

    return {
      amountMinor: debit === 0 ? credit : -Math.abs(debit),
      debit:
        debit === 0 ? null : { line: debitText.line, column: amount.debit, negative: debit < 0 },
    };
  });

const readLine = (row: CsvRow, reading: Reading): Effect.Effect<Read, ReadError> =>
  Effect.gen(function* () {
    const { profile, read } = reading;
    const { columns } = profile;
    const bookedOn = yield* readDay(row, "bookedOn", columns.bookedOn, read, profile.dateFormat);

    if (bookedOn === null) {
      return yield* new MissingField({
        line: cellAt(row, columns.bookedOn).line,
        column: columns.bookedOn,
        field: "bookedOn",
      });
    }

    const valueOn =
      columns.valueOn === null
        ? null
        : yield* readDay(row, "valueOn", columns.valueOn, read, profile.dateFormat);

    const { amountMinor, debit } = yield* readLineAmount(row, reading);
    const lineCurrency = optionalText(row, columns.currency);

    if (reading.checkCurrency && columns.currency !== null && lineCurrency !== null) {
      if (lineCurrency.toUpperCase() !== reading.currency) {
        return yield* new UnsupportedContent({
          line: cellAt(row, columns.currency).line,
          column: columns.currency,
          problem: `A line in ${quote(lineCurrency)}, in a file read for an account in ${reading.currency}.`,
        });
      }
    }

    return {
      line: {
        bookedOn,
        valueOn,
        amountMinor,
        label: optionalText(row, columns.label) ?? "",
        memo: optionalText(row, columns.memo),
        bankId: optionalText(row, columns.bankId),
        counterparty: null,
      },
      debit,
    };
  });

/**
 * A debit column whose amounts are all positive or all negative tells which way the money went;
 * one holding both does not, since either sign may then be a refund.
 */
function checkDebitSigns(read: ReadonlyArray<Read>): Effect.Effect<void, UnsupportedContent> {
  const debits = read.flatMap((entry) => (entry.debit === null ? [] : [entry.debit]));
  const [first] = debits;
  const other = debits.find((debit) => debit.negative !== first?.negative);

  if (first === undefined || other === undefined) {
    return Effect.void;
  }

  return Effect.fail(
    new UnsupportedContent({
      line: other.line,
      column: other.column,
      problem: `A debit signed otherwise than the one at line ${String(first.line)}: which way the money went cannot be told.`,
    }),
  );
}

type DecodeError = MalformedFile | UnsupportedContent;

/**
 * A CSV file as profiles read it: its text in an encoding, decoded once whatever the number of
 * profiles tried on it (`csvFile`).
 */
export type CsvFile = {
  readonly text: (encoding: CsvEncoding) => Effect.Effect<string, DecodeError>;
};

/**
 * A file's bytes, to be read by several profiles: each encoding is decoded at the first read that
 * asks for it, and that text, or that refusal, is given to every later one. Decoding is what costs
 * most on a large file; at most two decodings are made, never one per profile.
 */
export function csvFile(bytes: Uint8Array): CsvFile {
  const decoded = new Map<CsvEncoding, Exit.Exit<string, DecodeError>>();

  return {
    text: (encoding) =>
      Effect.suspend(() => {
        const known = decoded.get(encoding);

        if (known !== undefined) {
          return known;
        }

        return Effect.flatMap(Effect.exit(decodeCsv(bytes, encoding)), (exit) => {
          decoded.set(encoding, exit);

          return exit;
        });
      }),
  };
}

/** How any profile splits a file into rows, a statement's or a broker's operations'. */
export type CsvTable = Pick<CsvProfile, "encoding" | "separator" | "skipRows" | "headerRow">;

/**
 * The rows of the file past the lines the profile skips, blank ones left out; all, or `limit`. With
 * a limit, the lines skipped are looked for within its characters too: a skipped line of megabytes
 * is not scanned to its end.
 */
export const readRows = (file: CsvFile, profile: CsvTable, limit?: ParseLimit) =>
  Effect.gen(function* () {
    const text = yield* file.text(profile.encoding);
    const { rest, line } = skipLines(text, profile.skipRows, limit?.characters);
    const rows = yield* parseRows(rest, profile.separator, line, limit);

    return { rows, line };
  });

/** A header row as a profile keeps it to recognise its files: lower case, trimmed, by `;`. */
export function normalizeHeader(cells: ReadonlyArray<string>): string {
  return cells.map((cell) => cleanValue(cell).toLowerCase()).join(";");
}

/**
 * The header row of a file read with a profile, normalised (`normalizeHeader`): what the import
 * compares with each of the user's profiles to choose the one that reads it. `null` when the
 * profile reads no header, or the file holds no row within the header search (`HEADER_SEARCH`).
 */
export const readCsvHeader = (
  file: CsvFile,
  profile: CsvTable,
): Effect.Effect<string | null, ReadError> =>
  Effect.gen(function* () {
    if (!profile.headerRow) {
      return null;
    }

    const { rows } = yield* readRows(file, profile, HEADER_SEARCH);
    const [header] = rows;

    return header === undefined ? null : normalizeHeader(header.cells.map((cell) => cell.text));
  });

/**
 * Where a header is looked for: the first row that holds something, within 100 lines past those the
 * profile skips (at most `MAX_SKIP_ROWS`), and within 64 KiB of text for the lines skipped and as
 * much for the search. A header further down is another file's. Every profile tried on a file reads
 * it so, the user's (at most fifty) and the shipped ones: the work of each is bounded by those
 * characters, never by the file's size, and the file is decoded once (`csvFile`).
 */
const HEADER_SEARCH: ParseLimit = { rows: 1, lines: 100, characters: 64 * 1024 };

/** What a profile is matched by: its definition, and the header of the files it reads, if kept. */
export type CsvCandidate = { readonly header: string | null; readonly profile: CsvDefinition };

/**
 * Whether a file's header row, as the candidate's profile reads it (`readCsvHeader`), is the one
 * the candidate recognises: its `header`, or, for PayPal's activity and a broker's export
 * (`layout`), any header that names the columns that layout needs, wherever they stand.
 */
export function headerMatches(candidate: CsvCandidate, header: string | null): boolean {
  if (candidate.header === null || header === null) {
    return false;
  }

  const { profile } = candidate;

  if (readsOperations(profile)) {
    return profile.layout === undefined
      ? header === candidate.header
      : isLayoutHeader(profile.layout, header);
  }

  return profile.layout === "paypal-activity"
    ? isPaypalHeader(header)
    : header === candidate.header;
}

/**
 * The first of `candidates` whose header the file's header row matches (`headerMatches`), as its
 * own profile reads it (`readCsvHeader`): the profile that recognises the file. A candidate with no
 * header, or whose profile cannot read the file's top (another encoding), is passed over;
 * `undefined` when none matches. Only the top of the file is parsed (`HEADER_SEARCH`), once per
 * candidate.
 */
export const matchCsvHeader = <Candidate extends CsvCandidate>(
  file: CsvFile,
  candidates: ReadonlyArray<Candidate>,
): Effect.Effect<Candidate | undefined> =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      if (candidate.header === null) {
        continue;
      }

      const header = yield* readCsvHeader(file, candidate.profile).pipe(
        Effect.match({ onFailure: () => null, onSuccess: (read) => read }),
      );

      if (headerMatches(candidate, header)) {
        return candidate;
      }
    }

    return undefined;
  });

/** An account's currency as `readCsv` takes it, upper case, or `InvalidOption`. */
export function currencyOf(text: string): Effect.Effect<string, InvalidOption> {
  const currency = text.toUpperCase();

  if (!/^[A-Z]{3}$/.test(currency)) {
    return Effect.fail(
      new InvalidOption({
        option: "currency",
        text: excerpt(text),
        expected: "a currency's ISO 4217 code, such as EUR",
      }),
    );
  }

  return Effect.succeed(currency);
}

/**
 * Reads a CSV file with an import profile: one account's lines, in `options.currency`, in the
 * file's order; a CSV file gives no balance.
 *
 * Every error names the line, and the column where one is at fault: a value that cannot be read as
 * the profile says (`InvalidField`, `field` being the profile's: `bookedOn`, `amount`, `debit`), a
 * line without its date or amount (`MissingField`), a header with fewer columns than the profile
 * reads (`MalformedFile`: the file is another bank's, or its separator differs).
 */
export const readCsv = (
  bytes: Uint8Array,
  profile: CsvProfile,
  options: CsvOptions,
): Effect.Effect<Statement, ReadError> =>
  Effect.flatMap(currencyOf(options.currency), (code) =>
    readTable(csvFile(bytes), profile, { code, checked: true }),
  );

/**
 * The rows a test read reads: the header and 50 lines, within 200 lines and 64 KiB of text past
 * those skipped, as the header search reads (`HEADER_SEARCH`). Enough to find a profile that does
 * not fit a file; few enough that trying fifty profiles on the server's thread costs what parsing
 * their tops costs, never a mebibyte each.
 */
export const SAMPLE: ParseLimit = { rows: 51, lines: 200, characters: 64 * 1024 };

/**
 * Reads the top of a file with a profile, as `readCsv` reads it whole: its first 50 lines past the
 * header, within 64 KiB of text (`SAMPLE`), which it gives. Fails with what `readCsv` would fail with there; succeeds when the profile
 * fits the file, as far as its top tells. With no `currency` (an import whose account is not chosen
 * yet), amounts are read with up to four decimals, in `CLF`, and the lines' currency is not
 * checked; the header must still have the currency column.
 */
export const testReadCsv = (
  file: CsvFile,
  profile: CsvProfile,
  currency: string | null,
): Effect.Effect<Statement, ReadError> => {
  if (currency !== null) {
    return Effect.flatMap(currencyOf(currency), (code) =>
      readTable(file, profile, { code, checked: true }, SAMPLE),
    );
  }

  // The currency with four minor digits, as detection reads amounts: no account to say better.
  return readTable(file, profile, { code: "CLF", checked: false }, SAMPLE);
};

/** What the import screen's preview shows of a file: its header and five rows, from its top. */
const PREVIEW: ParseLimit = { rows: 6, lines: 100, characters: 64 * 1024 };

/**
 * The first rows of a file as a profile splits them (its encoding, its separator, the lines it
 * skips), each value as written, blank rows left out: the import screen's preview, the header first
 * when the file has one. Only the file's top is parsed (`PREVIEW`).
 */
export const previewCsvRows = (
  file: CsvFile,
  profile: CsvTable,
): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, ReadError> =>
  Effect.map(readRows(file, profile, PREVIEW), ({ rows }) =>
    rows.map((row) => row.cells.map((cell) => cell.text)),
  );

/** The lines of the file, or of its top with `limit`, in `currency` (its code checked by the caller). */
const readTable = (
  file: CsvFile,
  profile: CsvProfile,
  currency: TableCurrency,
  limit?: ParseLimit,
): Effect.Effect<Statement, ReadError> =>
  Effect.gen(function* () {
    const { rows, line } = yield* readRows(file, profile, limit);
    const [header, ...data] = rows;

    // PayPal's activity names its columns, which its user chooses: they are found by their names.
    if (profile.layout === "paypal-activity") {
      if (header === undefined) {
        return yield* new MalformedFile({
          line,
          problem: "No header row: PayPal's activity starts with the names of its columns.",
        });
      }

      return {
        account: null,
        currency: currency.code,
        lines: yield* readPaypalRows(header, data, currency),
        openingBalance: null,
        balance: null,
      };
    }

    if (profile.headerRow) {
      if (header === undefined) {
        return yield* new MalformedFile({
          line,
          problem: "No header row: the file holds nothing past the lines the profile skips.",
        });
      }

      const needed = lastColumn(profile);

      if (header.cells.length < needed) {
        return yield* new MalformedFile({
          line: header.line,
          problem: `Column ${String(needed)} is past the header's last (column ${String(header.cells.length)}): the file may be another bank's, or its separator another.`,
        });
      }
    }

    const reading: Reading = {
      profile,
      currency: currency.code,
      checkCurrency: currency.checked,
      syntax: profile.decimalMark === "." ? "decimal-point" : "decimal-comma",
      read: dayReader(profile.dateFormat),
    };

    const lines = profile.headerRow || header === undefined ? data : [header, ...data];
    const read = yield* Effect.forEach(lines, (row) => readLine(row, reading));

    yield* checkDebitSigns(read);

    return {
      account: null,
      currency: currency.code,
      lines: read.map((entry) => entry.line),
      openingBalance: null,
      balance: null,
    };
  });
