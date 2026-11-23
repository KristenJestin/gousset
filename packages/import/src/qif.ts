import { Effect } from "effect";

import { readAmount } from "./amount";
import type { FieldText } from "./amount";
import { qifDay, readQifDate } from "./dates";
import type { DateOrder, QifDate } from "./dates";
import {
  InvalidField,
  InvalidOption,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";
import type { ReadError } from "./errors";
import type { Statement, StatementLine } from "./statement";
import { cleanValue, decodeText, quote, splitLines } from "./text";

// QIF: header lines (`!Type:Bank`), then records of one field per line, a letter then its value
// (`D` the date, `T` the amount, `P` the payee...), each record ended by `^`.

export type QifOptions = {
  /**
   * The ISO 4217 code of the account the file goes into (`EUR`, `eur` taken as `EUR`): a QIF file
   * names no currency. Anything else is refused with `InvalidOption`.
   */
  currency: string;
  /** How to read `03/04/2026`, when the caller knows; otherwise the file decides (`QifDateOrder`). */
  dateOrder?: DateOrder;
};

/**
 * How the file's dates were read. `file`: only that order makes every date of the file a day of
 * the calendar (or the file writes ISO dates only). `option`: the caller's. `default`: both orders
 * fit every date, and day first was taken, as French banks write; the import should ask the user.
 */
export type QifDateOrder = { order: DateOrder; decidedBy: "file" | "option" | "default" };

export type QifStatement = Statement & { dateOrder: QifDateOrder };

type QifRecord = { line: number; fields: Array<FieldText> };

/** The account types whose records are money movements, one per record. */
const ACCOUNT_SECTION = /^type:(bank|cash|ccard|oth a|oth l)$/i;

/** Lists Quicken exports beside the transactions (categories, accounts, options): read past. */
const LIST_SECTION =
  /^(type:(cat|class|memorized|prices|security|template)|account|option:.*|clear:.*)$/i;

/** The records of the file's one account section, each with the line it starts on. */
const readRecords = (text: string) =>
  Effect.gen(function* () {
    const records: Array<QifRecord> = [];
    let section: "none" | "account" | "list" = "none";
    let accounts = 0;
    let current: QifRecord | undefined;

    for (const [index, written] of splitLines(text).entries()) {
      const line = index + 1;
      const content = written.trim();

      if (content === "") {
        continue;
      }

      if (content.startsWith("!")) {
        const header = content.slice(1).trim();

        if (current !== undefined) {
          records.push(current);
          current = undefined;
        }

        if (ACCOUNT_SECTION.test(header)) {
          accounts += 1;
          section = "account";
        } else if (LIST_SECTION.test(header)) {
          section = "list";
        } else if (/^type:invst$/i.test(header)) {
          return yield* new UnsupportedContent({
            line,
            problem: "An investment account: Gousset reads bank and card accounts.",
          });
        } else {
          return yield* new UnsupportedContent({ line, problem: `A section ${quote(header)}.` });
        }

        if (accounts > 1) {
          return yield* new UnsupportedContent({
            line,
            problem: "A second account's transactions: export one account per file.",
          });
        }

        continue;
      }

      if (section === "none") {
        return yield* new NotAStatement({ format: "qif" });
      }

      if (section === "list") {
        continue;
      }

      if (content.startsWith("^")) {
        if (current !== undefined) {
          records.push(current);
          current = undefined;
        }

        continue;
      }

      current ??= { line, fields: [] };
      current.fields.push({ field: content.charAt(0), text: cleanValue(content.slice(1)), line });
    }

    if (current !== undefined) {
      records.push(current);
    }

    if (section === "none") {
      return yield* new NotAStatement({ format: "qif" });
    }

    return records;
  });

function field(record: QifRecord, code: string): FieldText | undefined {
  return record.fields.find((candidate) => candidate.field === code);
}

function required(record: QifRecord, code: string): Effect.Effect<FieldText, MissingField> {
  const found = field(record, code);

  if (found === undefined) {
    return Effect.fail(new MissingField({ line: record.line, field: code }));
  }

  return Effect.succeed(found);
}

const DATE_EXAMPLE = "a date such as 03/10/2026, 10/3'26, 03.10.2026 or 2026-10-03";

/**
 * Quicken's first record when it exports an account whole: the account's opening balance, booked
 * as a transfer from the account itself (`POpening Balance`, `L[Checking]`). It is no movement.
 */
function isOpeningBalance(record: QifRecord): boolean {
  const payee = field(record, "P")?.text ?? "";
  const category = field(record, "L")?.text ?? "";

  return /^opening balance$/i.test(payee) && /^\[.*\]$/.test(category);
}

/** Every date must be a day of the calendar when read in that order. */
function fitsEvery(dates: ReadonlyArray<QifDate>, order: DateOrder): boolean {
  return dates.every((date) => qifDay(date, order) !== undefined);
}

function decideOrder(dates: ReadonlyArray<QifDate>, wanted: DateOrder | undefined): QifDateOrder {
  if (wanted !== undefined) {
    return { order: wanted, decidedBy: "option" };
  }

  const dayFirst = fitsEvery(dates, "day-first");
  const monthFirst = fitsEvery(dates, "month-first");

  if (monthFirst && !dayFirst) {
    return { order: "month-first", decidedBy: "file" };
  }

  const ambiguous = dayFirst && monthFirst && dates.some((date) => date.kind === "numbers");

  return { order: "day-first", decidedBy: ambiguous ? "default" : "file" };
}

/** A field's text; `null` when the record lacks it or leaves it empty. */
function textOf(record: QifRecord, code: string): string | null {
  const found = field(record, code);

  return found === undefined || found.text === "" ? null : found.text;
}

type Entry = { record: QifRecord; written: FieldText; date: QifDate; amountMinor: number };

function book(entry: Entry, order: DateOrder): Effect.Effect<StatementLine, InvalidField> {
  const bookedOn = qifDay(entry.date, order);

  if (bookedOn === undefined) {
    return Effect.fail(
      new InvalidField({ ...entry.written, expected: `${DATE_EXAMPLE}, read ${order}` }),
    );
  }

  return Effect.succeed({
    bookedOn,
    valueOn: null,
    amountMinor: entry.amountMinor,
    label: textOf(entry.record, "P") ?? "",
    memo: textOf(entry.record, "M"),
    bankId: textOf(entry.record, "N"),
  });
}

/**
 * Reads a QIF file: one bank, cash, card or other account's transactions (`!Type:Bank`,
 * `!Type:Cash`, `!Type:CCard`, `!Type:Oth A`, `!Type:Oth L`), in `options.currency`.
 *
 * Amounts are taken signed as written (`T`, or `U` when `T` is missing); split lines (`S`, `$`)
 * are read past, the record's total being the line. The day and the month of a date are told
 * apart by the whole file (`QifDateOrder`). A QIF file gives no balance, except Quicken's opening
 * balance record: it is then no line, and the balance is that opening balance plus every line,
 * as of the last line's day.
 */
export const readQif = (
  bytes: Uint8Array,
  options: QifOptions,
): Effect.Effect<QifStatement, ReadError> =>
  Effect.gen(function* () {
    const currency = options.currency.toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      return yield* new InvalidOption({
        option: "currency",
        text: options.currency,
        expected: "a currency's ISO 4217 code, such as EUR",
      });
    }

    const records = yield* readRecords(decodeText(bytes));

    const entries = yield* Effect.forEach(records, (record) =>
      Effect.gen(function* () {
        const written = yield* required(record, "D");
        const date = readQifDate(written.text);

        if (date === undefined) {
          return yield* new InvalidField({ ...written, expected: DATE_EXAMPLE });
        }

        const amount = field(record, "T") ?? field(record, "U");

        if (amount === undefined) {
          return yield* new MissingField({ line: record.line, field: "T" });
        }

        const amountMinor = yield* readAmount(amount, currency, "qif");

        return { record, written, date, amountMinor };
      }),
    );

    const dateOrder = decideOrder(
      entries.map((entry) => entry.date),
      options.dateOrder,
    );

    const booked = yield* Effect.forEach(entries, (entry) => book(entry, dateOrder.order));
    const [first] = booked;
    const [firstRecord] = records;

    if (first === undefined || firstRecord === undefined || !isOpeningBalance(firstRecord)) {
      return { currency, lines: booked, balance: null, dateOrder };
    }

    const lines = booked.slice(1);
    let amountMinor = first.amountMinor;
    let on = first.bookedOn;

    for (const line of lines) {
      amountMinor += line.amountMinor;
      on = line.bookedOn > on ? line.bookedOn : on;
    }

    return { currency, lines, balance: { amountMinor, on }, dateOrder };
  });
