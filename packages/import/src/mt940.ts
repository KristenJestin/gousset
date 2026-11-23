import { Effect } from "effect";

import { invalidField, readAmount } from "./amount";
import type { FieldText } from "./amount";
import { earliest, latest } from "./balances";
import { dayBefore, mt940Day, mt940EntryDay } from "./dates";
import { MissingField, NotAStatement, UnsupportedContent } from "./errors";
import type { ReadError } from "./errors";
import type { Balance, Counterparty, Statement, StatementLine } from "./statement";
import { cleanValue, decodeText, ibanOf, nonEmpty } from "./text";

// SWIFT MT940, the customer statement message: fields of a tag and a value (`:61:` a line, `:86:`
// what the bank says of it), a field's value running on over the lines that start no field. A file
// holds one message or several, maybe in SWIFT's blocks (`{1:…}{2:…}{4:` then `-}`), each a
// statement or a page of one (`:20:` its reference, `:25:` the account, `:60F:` and `:62F:` its
// balances, `M` for a page's).

type Mt940Field = {
  /** The tag without its colons: `20`, `61`, `60F`. */
  tag: string;
  /** The file line the tag stands on. */
  line: number;
  /** The value, its lines joined by `\n`, as written. */
  text: string;
};

// `[\s\S]`, not `.`: a value may hold U+2028 or U+2029, which `.` and `$` stop at, and the field
// would silently run into the one before it.
const TAG = /^:(\d{2}[A-Z]?):([\s\S]*)$/;

/**
 * How many fields and continuation lines a file may hold together. A statement line takes two
 * fields and an `:86:` a few lines, and years of a bank's daily statements are some tens of
 * thousands; refusing more keeps the reader's memory in proportion to a statement, where 64 MiB of
 * `:20:` lines, or of one-letter lines running on one field, would pass the engine's heap.
 */
const MAX_PIECES = 1_000_000;

/**
 * How long a field may be. SWIFT caps `:86:` at six lines of 65 characters, and banks that go past
 * stay within a few hundred; a longer field is no statement's, and refusing it keeps `:86:` from
 * being split into millions of parts.
 */
const MAX_FIELD_LENGTH = 10_000;

const tooManyPieces = new UnsupportedContent({
  line: 1,
  problem: "More than a million fields and lines: no statement holds that many.",
});

/**
 * The file's fields, in order; SWIFT's block headers and trailers read past. Its lines, whatever
 * ends them (`\r\n`, `\n`, a lone `\r`), are visited one by one, never held in an array, and every
 * field and continuation line is counted as it is read.
 */
const readFields = (text: string) =>
  Effect.gen(function* () {
    const fields: Array<Mt940Field> = [];
    const lineEnds = /\r\n|\r|\n/g;
    let current: Mt940Field | undefined;
    let pieces = 0;
    let start = 0;
    let line = 0;

    while (start <= text.length) {
      lineEnds.lastIndex = start;

      const lineEnd = lineEnds.exec(text);
      const written = text.slice(start, lineEnd?.index ?? text.length);

      start = lineEnd === null ? text.length + 1 : lineEnd.index + lineEnd[0].length;
      line += 1;

      const block = written.indexOf("{4:");
      const content = block === -1 ? written : written.slice(block + 3);
      const trimmed = content.trim();

      // A header block (`{1:`, `{2:`, `{3:`), the end of a message (`-`, `-}`), a trailer (`{5:`).
      if (
        (block === -1 && trimmed.startsWith("{")) ||
        trimmed === "-" ||
        trimmed.startsWith("-}")
      ) {
        current = undefined;

        continue;
      }

      const tag = TAG.exec(content);
      const runsOn = tag === null && current !== undefined && trimmed !== "";

      pieces += tag !== null || runsOn ? 1 : 0;

      if (pieces > MAX_PIECES) {
        return yield* tooManyPieces;
      }

      if (tag !== null) {
        current = { tag: tag[1] ?? "", line, text: tag[2] ?? "" };
        fields.push(current);
      } else if (runsOn && current !== undefined) {
        current.text += `\n${content}`;
      }

      if (current !== undefined && current.text.length > MAX_FIELD_LENGTH) {
        return yield* new UnsupportedContent({
          line: current.line,
          problem: `A :${current.tag}: field of more than 10,000 characters: no statement writes one.`,
        });
      }
    }

    return fields;
  });

type Mt940Statement = { start: Mt940Field; fields: Array<Mt940Field> };

function find(statement: Mt940Statement, tags: ReadonlyArray<string>): Mt940Field | undefined {
  return statement.fields.find((candidate) => tags.includes(candidate.tag));
}

function required(
  statement: Mt940Statement,
  tags: ReadonlyArray<string>,
): Effect.Effect<Mt940Field, MissingField> {
  const found = find(statement, tags);

  if (found === undefined) {
    return Effect.fail(
      new MissingField({ line: statement.start.line, field: `:${tags[0] ?? ""}:` }),
    );
  }

  return Effect.succeed(found);
}

function written(field: Mt940Field, text: string): FieldText {
  return { field: `:${field.tag}:`, text, line: field.line };
}

const BALANCE = /^([CD])(\d{6})([A-Z]{3})([\d,]+)$/;

/** A balance field (`:60F:`, `:62M:`): its mark, day, currency and amount (`C261031EUR1234,56`). */
const readBalance = (field: Mt940Field) =>
  Effect.gen(function* () {
    const value = field.text.trim();
    const parts = BALANCE.exec(value);

    if (parts === null) {
      return yield* invalidField(written(field, value), "a balance such as C261031EUR1234,56");
    }

    const [, mark = "", date = "", currency = "", amount = ""] = parts;
    const on = mt940Day(date);

    if (on === undefined) {
      return yield* invalidField(written(field, date), "a date such as 261031 (YYMMDD)");
    }

    const minor = yield* readAmount(written(field, amount), currency, "mt940");
    const balance: Balance = { amountMinor: mark === "D" && minor !== 0 ? -minor : minor, on };

    return { balance, currency };
  });

/** What `:86:` says of a line, read into the line's fields. */
type Information = { label: string | null; memo: string | null; counterparty: Counterparty | null };

function counterpartyOf(name: string | null, iban: string | null): Counterparty | null {
  return name === null && iban === null ? null : { name, iban };
}

/** A structured value's parts may be cut anywhere: they are joined as written, then tidied. */
function joined(parts: ReadonlyArray<string>): string | null {
  return nonEmpty(cleanValue(parts.join("")));
}

/**
 * The German banks' structured `:86:` (`166?00GUTSCHRIFT?20…?32…`): a three-digit code, then
 * subfields of a two-digit code after a `?`. `?00` the booking text, `?20` to `?29` and `?60` to
 * `?63` the remittance information, `?31` the counterparty's account, `?32` and `?33` their name.
 */
function readSubfields(text: string): Information {
  const subfields: Array<{ code: number; value: string }> = [];

  for (const part of text.slice(4).split("?")) {
    const previous = subfields.at(-1);

    // A `?` not followed by a code belongs to the value before it.
    if (previous !== undefined && !/^\d{2}/.test(part)) {
      previous.value += `?${part}`;
    } else {
      subfields.push({ code: Number(part.slice(0, 2)), value: part.slice(2) });
    }
  }

  const values = (test: (code: number) => boolean) =>
    subfields.flatMap((subfield) => (test(subfield.code) ? [subfield.value] : []));

  const remittance = joined(
    values((code) => (code >= 20 && code <= 29) || (code >= 60 && code <= 63)),
  );

  const booking = joined(values((code) => code === 0));
  const name = joined(values((code) => code === 32 || code === 33));
  const iban = ibanOf(joined(values((code) => code === 31)));

  return {
    label: remittance ?? booking ?? name,
    memo: remittance === null ? null : booking,
    counterparty: counterpartyOf(name, iban),
  };
}

/** The codes of the slash-structured `:86:` (`/TRTP/…/NAME/…/REMI/…`) that it may hold. */
const CODES = [
  "ADDR",
  "ATTR",
  "BENM",
  "BIC",
  "CDTRREF",
  "CDTRREFTP",
  "CNTP",
  "CREF",
  "CSID",
  "EREF",
  "IBAN",
  "IREF",
  "ISDT",
  "MARF",
  "NAME",
  "OCMT",
  "ORDP",
  "PREF",
  "PURP",
  "REMI",
  "RTRN",
  "SVCL",
  "TRTP",
  "ULTB",
  "ULTC",
  "ULTD",
];

const CODE = new RegExp(`/(${CODES.join("|")})/`, "g");

const STARTS_WITH_CODE = new RegExp(`^/(${CODES.join("|")})/`);

function withoutTrailingSlashes(text: string): string {
  let end = text.length;

  while (end > 0 && text.charAt(end - 1) === "/") {
    end -= 1;
  }

  return text.slice(0, end);
}

/**
 * The slash-structured `:86:` (`/TRTP/SEPA OVERBOEKING/IBAN/…/NAME/…/REMI/USTD//…`): each code's
 * value runs to the next code. `/TRTP/` the booking text, `/REMI/` the remittance information,
 * `/NAME/` and `/IBAN/` the counterparty, or `/CNTP/` with their IBAN, BIC, name and town.
 */
function readCodes(text: string): Information {
  const found = [...text.matchAll(CODE)];
  const values = new Map<string, string>();

  for (const [index, match] of found.entries()) {
    const code = match[1] ?? "";
    const start = match.index + match[0].length;
    const end = found[index + 1]?.index ?? text.length;

    if (!values.has(code)) {
      values.set(code, withoutTrailingSlashes(text.slice(start, end)));
    }
  }

  const counterpart = (values.get("CNTP") ?? "").split("/");

  const remittance = nonEmpty(
    cleanValue((values.get("REMI") ?? "").replace(/^USTD\/\//, "").replace(/^STRD\/[A-Z]*\//, "")),
  );

  const booking = nonEmpty(cleanValue(values.get("TRTP") ?? ""));
  const name = nonEmpty(cleanValue(values.get("NAME") ?? counterpart[2] ?? ""));
  const iban = ibanOf(values.get("IBAN") ?? counterpart[0] ?? null);

  return {
    label: remittance ?? booking ?? name,
    memo: remittance === null ? null : booking,
    counterparty: counterpartyOf(name, iban),
  };
}

/** What a line's `:86:` says, in whichever of its three forms; free text is the label as it is. */
function readInformation(field: Mt940Field | undefined): Information {
  if (field === undefined) {
    return { label: null, memo: null, counterparty: null };
  }

  // A structured value's lines are cut by length, anywhere: they are joined without a space.
  const unwrapped = field.text.replaceAll("\n", "");

  if (/^\d{3}\?\d{2}/.test(unwrapped)) {
    return readSubfields(unwrapped);
  }

  if (STARTS_WITH_CODE.test(unwrapped)) {
    return readCodes(unwrapped);
  }

  return { label: nonEmpty(cleanValue(field.text)), memo: null, counterparty: null };
}

/**
 * `:61:`: the value date (`YYMMDD`), maybe the entry date (`MMDD`), the mark (`C`, `D`, `RC` a
 * reversed credit, `RD` a reversed debit), maybe the funds code (the currency's third letter), the
 * amount, the type (`NTRF`), the account owner's reference, then `//` and the bank's. Its next lines
 * are supplementary details.
 */
const LINE = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([NSF][A-Z\d]{3})([\s\S]*)$/;

/** A statement line, and whether `:61:` gave its entry date (else it is booked on its value date). */
type Read = { line: StatementLine; entered: boolean };

const LINE_EXAMPLE = "a statement line such as 2610031003D4,20NTRFNONREF//EX2026100301";

const readLine = (
  field: Mt940Field,
  information: Mt940Field | undefined,
  currency: string,
): Effect.Effect<Read, ReadError> =>
  Effect.gen(function* () {
    const [first = "", ...supplementary] = field.text.split("\n");
    const value = first.trim();
    const parts = LINE.exec(value);

    if (parts === null) {
      return yield* invalidField(written(field, value), LINE_EXAMPLE);
    }

    const [, valueDate = "", entryDate, mark = "", , amount = "", , references = ""] = parts;
    const valueOn = mt940Day(valueDate);

    if (valueOn === undefined) {
      return yield* invalidField(written(field, valueDate), "a value date such as 261003 (YYMMDD)");
    }

    const bookedOn = entryDate === undefined ? valueOn : mt940EntryDay(entryDate, valueOn);

    if (bookedOn === undefined) {
      return yield* invalidField(
        written(field, entryDate ?? ""),
        "an entry date such as 1003 (MMDD)",
      );
    }

    const minor = yield* readAmount(written(field, amount), currency, "mt940");
    const out = mark === "D" || mark === "RC";
    const at = references.indexOf("//");
    const owner = cleanValue(at === -1 ? references : references.slice(0, at));
    const servicer = cleanValue(at === -1 ? "" : references.slice(at + 2));
    const details = readInformation(information);

    const line: StatementLine = {
      bookedOn,
      valueOn,
      amountMinor: out && minor !== 0 ? -minor : minor,
      label: details.label ?? cleanValue(supplementary.join(" ")),
      memo: details.memo,
      bankId: nonEmpty(servicer) ?? (/^nonref$/i.test(owner) ? null : nonEmpty(owner)),
      counterparty: details.counterparty,
    };

    return { line, entered: entryDate !== undefined };
  });

/** A statement's balance among `tags` (`60F` or `60M`), in the account's currency. */
const readBalanceIn = (statement: Mt940Statement, tags: ReadonlyArray<string>, currency: string) =>
  Effect.gen(function* () {
    const field = yield* required(statement, tags);
    const read = yield* readBalance(field);

    if (read.currency !== currency) {
      return yield* new UnsupportedContent({
        line: field.line,
        problem: `A balance in ${read.currency}, while the account is in ${currency}.`,
      });
    }

    return { tag: field.tag, balance: read.balance };
  });

/**
 * A statement's opening balance (`:60F:`) as a `Balance`, the end of a day. SWIFT dates it as the
 * previous statement's closing balance, the end of that day; many banks date it on the statement's
 * own first day instead, before that day's lines. When the statement books a line, by its entry
 * date, on or before its day, it is the second: the balance at the end of the day before. A line
 * without an entry date does not count: its day is its value date, often days before the booking.
 */
function openingOf(balance: Balance, booked: ReadonlyArray<Read>): Balance {
  return booked.some((read) => read.entered && read.line.bookedOn <= balance.on)
    ? { amountMinor: balance.amountMinor, on: dayBefore(balance.on) }
    : balance;
}

/** The statements of the file, each from its `:20:`; fields before the first are read past. */
function readStatements(fields: ReadonlyArray<Mt940Field>): Array<Mt940Statement> {
  const statements: Array<Mt940Statement> = [];

  for (const field of fields) {
    const current = statements.at(-1);

    if (field.tag === "20") {
      statements.push({ start: field, fields: [] });
    } else if (current !== undefined) {
      current.fields.push(field);
    }
  }

  return statements;
}

/**
 * Reads an MT940 file: one account's statements, or pages of one, with or without SWIFT's blocks,
 * their lines in the file's order.
 *
 * Amounts are signed by their mark (`D` and `RC` out, `C` and `RD` in). `:86:` is read in its three
 * forms: free text, the German banks' `?` subfields, and the `/CODE/` form. The opening balance is
 * the earliest `:60F:` (`openingOf`), the closing balance the latest `:62F:`; a page's balances
 * (`:60M:`, `:62M:`), struck in the middle of a day, are checked and read past.
 */
export const readMt940 = (bytes: Uint8Array): Effect.Effect<Statement, ReadError> =>
  Effect.gen(function* () {
    const statements = readStatements(yield* readFields(yield* decodeText(bytes)));
    const [first] = statements;

    if (first === undefined) {
      return yield* new NotAStatement({ format: "mt940" });
    }

    const accountOf = (statement: Mt940Statement) =>
      Effect.map(required(statement, ["25"]), (field) =>
        field.text.replaceAll(/\s/g, "").toUpperCase(),
      );

    const account = yield* accountOf(first);
    const { currency } = yield* readBalance(yield* required(first, ["60F", "60M"]));
    const openings: Array<Balance> = [];
    const closings: Array<Balance> = [];
    const lines: Array<StatementLine> = [];

    for (const statement of statements) {
      if ((yield* accountOf(statement)) !== account) {
        return yield* new UnsupportedContent({
          line: statement.start.line,
          problem: "A second account's statement: export one account per file.",
        });
      }

      const opening = yield* readBalanceIn(statement, ["60F", "60M"], currency);
      const closing = yield* readBalanceIn(statement, ["62F", "62M"], currency);
      const booked: Array<Read> = [];

      for (const [index, field] of statement.fields.entries()) {
        const next = statement.fields[index + 1];

        if (field.tag === "61") {
          booked.push(yield* readLine(field, next?.tag === "86" ? next : undefined, currency));
        }
      }

      if (opening.tag === "60F") {
        openings.push(openingOf(opening.balance, booked));
      }

      if (closing.tag === "62F") {
        closings.push(closing.balance);
      }

      // One by one: a spread of a great many lines would pass the engine's argument limit.
      for (const read of booked) {
        lines.push(read.line);
      }
    }

    return { currency, lines, openingBalance: earliest(openings), balance: latest(closings) };
  });
