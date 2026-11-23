import { Effect } from "effect";

import { invalidField, readAmount } from "./amount";
import type { FieldText } from "./amount";
import { earliest, latest } from "./balances";
import { mt940Day, mt940EntryDay } from "./dates";
import { MissingField, NotAStatement, UnsupportedContent } from "./errors";
import type { ReadError } from "./errors";
import type { Balance, Counterparty, Statement, StatementLine } from "./statement";
import { cleanValue, decodeText, ibanOf, nonEmpty, splitLines } from "./text";

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

const TAG = /^:(\d{2}[A-Z]?):(.*)$/;

/** The file's fields, in order; SWIFT's block headers and trailers read past. */
function readFields(text: string): Array<Mt940Field> {
  const fields: Array<Mt940Field> = [];
  let current: Mt940Field | undefined;

  for (const [index, written] of splitLines(text).entries()) {
    const block = written.indexOf("{4:");
    const content = block === -1 ? written : written.slice(block + 3);
    const trimmed = content.trim();

    // A header block (`{1:`, `{2:`, `{3:`), the end of a message (`-`, `-}`), a trailer (`{5:`).
    if ((block === -1 && trimmed.startsWith("{")) || trimmed === "-" || trimmed.startsWith("-}")) {
      current = undefined;

      continue;
    }

    const tag = TAG.exec(content);

    if (tag !== null) {
      current = { tag: tag[1] ?? "", line: index + 1, text: tag[2] ?? "" };
      fields.push(current);
    } else if (current !== undefined && trimmed !== "") {
      current.text += `\n${content}`;
    }
  }

  return fields;
}

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
const LINE = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([NSF][A-Z\d]{3})(.*)$/;

const LINE_EXAMPLE = "a statement line such as 2610031003D4,20NTRFNONREF//EX2026100301";

const readLine = (field: Mt940Field, information: Mt940Field | undefined, currency: string) =>
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

    return line;
  });

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
 * the earliest `:60F:` or `:60M:`, the closing balance the latest `:62F:` or `:62M:`; each is the
 * balance at the end of its day, as SWIFT defines them.
 */
export const readMt940 = (bytes: Uint8Array): Effect.Effect<Statement, ReadError> =>
  Effect.gen(function* () {
    const statements = readStatements(readFields(yield* decodeText(bytes)));
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

      for (const [tags, balances] of [
        [["60F", "60M"], openings],
        [["62F", "62M"], closings],
      ] as const) {
        const field = yield* required(statement, tags);
        const read = yield* readBalance(field);

        if (read.currency !== currency) {
          return yield* new UnsupportedContent({
            line: field.line,
            problem: `A balance in ${read.currency}, while the account is in ${currency}.`,
          });
        }

        balances.push(read.balance);
      }

      for (const [index, field] of statement.fields.entries()) {
        const next = statement.fields[index + 1];

        if (field.tag === "61") {
          lines.push(yield* readLine(field, next?.tag === "86" ? next : undefined, currency));
        }
      }
    }

    return { currency, lines, openingBalance: earliest(openings), balance: latest(closings) };
  });
