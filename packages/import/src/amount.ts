import { minorDigits } from "@gousset/currency";
import { Effect } from "effect";

import { InvalidField } from "./errors";
import { excerpt, quote } from "./text";

// The one ISO 4217 table (packages/currency): the web form, the MCP door and the imports agree on
// every currency's minor units.
export { minorDigits } from "@gousset/currency";

/**
 * A field's text and where it stands in the file, for the error that names it: its line, and its
 * column in a CSV file.
 */
export type FieldText = { field: string; text: string; line: number; column?: number };

/** The error for a field that cannot be read: its text cut to 40 characters, as written. */
export function invalidField(written: FieldText, expected: string): InvalidField {
  return new InvalidField({ ...written, text: excerpt(written.text), expected });
}

/**
 * How a format writes amounts. `ofx`: an optional sign, digits and at most one decimal mark, `.` or
 * `,` (French banks write a comma), never a thousands separator. `qif`: the same, and thousands
 * may be grouped (`1,234.56`, `1.234,56`, `1 234,56`, `1'234.56`). `decimal-point` and
 * `decimal-comma`: a CSV profile names the decimal mark, so thousands may be grouped by any other
 * mark (`1,234.56`, `1 234,56`, `1.234,56`, `1'234.56`), each group of three digits. `camt053`:
 * digits and a decimal point, never a sign (the credit or debit indicator gives the direction).
 * `mt940`: the same with a decimal comma.
 */
export type AmountSyntax = "ofx" | "qif" | "decimal-point" | "decimal-comma" | "camt053" | "mt940";

const EXAMPLES = {
  ofx: "an amount such as -1234.56 or -1234,56",
  qif: "an amount such as -1,234.56, -1.234,56 or -1234,56",
  "decimal-point": "an amount such as -1234.56 or -1,234.56",
  "decimal-comma": "an amount such as -1234,56 or -1 234,56",
  camt053: "an amount such as 1234.56",
  mt940: "an amount such as 1234,56",
} satisfies { [syntax in AmountSyntax]: string };

/** The syntaxes of digits and one decimal mark, with no thousands separator. */
type DecimalSyntax = "ofx" | "camt053" | "mt940";

const DECIMAL = {
  ofx: /^(\d*)(?:[.,](\d*))?$/,
  camt053: /^(\d*)(?:\.(\d*))?$/,
  mt940: /^(\d*)(?:,(\d*))?$/,
} satisfies { [syntax in DecimalSyntax]: RegExp };

const SEPARATORS = /[.,'   ]/;

type Split = { whole: string; fraction: string } | { expected: string };

function splitDecimal(unsigned: string, syntax: DecimalSyntax): Split {
  const parts = DECIMAL[syntax].exec(unsigned);

  if (parts === null) {
    return { expected: EXAMPLES[syntax] };
  }

  return { whole: parts[1] ?? "", fraction: parts[2] ?? "" };
}

/**
 * Where both marks appear, the last one is the decimal mark. A mark written once is a decimal mark,
 * unless exactly three digits follow it: `1,234` is a thousand and some, or one and a fraction, and
 * guessing would put a wrong amount in the ledger, so it is refused. In a currency of three minor
 * units it is taken as the decimal mark: that is how such a currency writes every amount under a
 * thousand (`12.500`), and refusing it would refuse them all; a thousand written `1,250`, with
 * neither its decimals nor a second group, is then read as 1.250.
 */
function splitQif(unsigned: string, digits: number): Split {
  if (!/^[\d.,'   ]+$/.test(unsigned)) {
    return { expected: EXAMPLES.qif };
  }

  const lastDot = unsigned.lastIndexOf(".");
  const lastComma = unsigned.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  const mark = unsigned.charAt(decimalAt);
  const once = decimalAt !== -1 && unsigned.indexOf(mark) === decimalAt;
  const bothMarks = lastDot !== -1 && lastComma !== -1;

  if (once && !bothMarks && unsigned.length - decimalAt - 1 === 3 && digits !== 3) {
    return { expected: `${EXAMPLES.qif}: ${quote(unsigned)} may be a thousand or a fraction` };
  }

  const whole = once ? unsigned.slice(0, decimalAt) : unsigned;
  const fraction = once ? unsigned.slice(decimalAt + 1) : "";
  const groups = whole.split(SEPARATORS);

  const grouped = groups.every((group, index) =>
    index === 0 ? /^\d{1,3}$/.test(group) : /^\d{3}$/.test(group),
  );

  if (!/^\d*$/.test(fraction) || (bothMarks && !once) || (groups.length > 1 && !grouped)) {
    return { expected: EXAMPLES.qif };
  }

  return { whole: groups.join(""), fraction };
}

/** What groups thousands beside each decimal mark: the other mark, spaces, an apostrophe. */
const GROUPING = { ".": /[,'   ]/, ",": /[.'   ]/ };

/** An amount whose decimal mark is known: every other mark groups thousands, by three digits. */
function splitMarked(unsigned: string, mark: "." | ","): Split {
  const expected = EXAMPLES[mark === "." ? "decimal-point" : "decimal-comma"];
  const [whole = "", fraction = "", ...more] = unsigned.split(mark);
  const groups = whole.split(GROUPING[mark]);

  const grouped = groups.every((group, index) =>
    index === 0 ? /^\d{1,3}$/.test(group) : /^\d{3}$/.test(group),
  );

  if (
    more.length > 0 ||
    !/^\d*$/.test(fraction) ||
    (groups.length > 1 ? !grouped : !/^\d*$/.test(whole))
  ) {
    return { expected };
  }

  return { whole: groups.join(""), fraction };
}

function splitAmount(unsigned: string, syntax: AmountSyntax, digits: number): Split {
  switch (syntax) {
    case "ofx":
    case "camt053":
    case "mt940":
      return splitDecimal(unsigned, syntax);
    case "qif":
      return splitQif(unsigned, digits);
    case "decimal-point":
      return splitMarked(unsigned, ".");
    case "decimal-comma":
      return splitMarked(unsigned, ",");
  }
}

const NUMBER_EXAMPLES = {
  "decimal-point": "a number such as 12.5 or 1,234.5678",
  "decimal-comma": "a number such as 12,5 or 1 234,5678",
};

/** The most digits a quantity or a unit price has before its decimal mark, and after it. */
const DECIMAL_DIGITS = { whole: 15, fraction: 10 };

/**
 * A quantity or a unit price a field writes, with a known decimal mark and thousands grouped by
 * any other (`1 234,5678`): exact, as text with a point and neither leading nor trailing zeros
 * (`1234.5678`, `0.0347`, `12`), the way Postgres writes a `numeric`, and whether a minus led it.
 * At most 15 digits before the mark and 10 after, as an operation keeps (docs/data-model.md, v0.6).
 */
export const readDecimal = (field: FieldText, syntax: "decimal-point" | "decimal-comma") =>
  Effect.gen(function* () {
    const written = field.text.trim();
    const signed = /^[+-]/.test(written);
    const unsigned = signed ? written.slice(1).trimStart() : written;
    const split = splitMarked(unsigned, syntax === "decimal-point" ? "." : ",");

    if ("expected" in split || !/\d/.test(`${split.whole}${split.fraction}`)) {
      return yield* invalidField(field, NUMBER_EXAMPLES[syntax]);
    }

    const whole = split.whole.replace(/^0+/, "");
    const fraction = split.fraction.replace(/0+$/, "");

    if (whole.length > DECIMAL_DIGITS.whole || fraction.length > DECIMAL_DIGITS.fraction) {
      return yield* invalidField(
        field,
        `a number of at most ${String(DECIMAL_DIGITS.whole)} digits before its decimal mark and ${String(DECIMAL_DIGITS.fraction)} after`,
      );
    }

    const text = `${whole === "" ? "0" : whole}${fraction === "" ? "" : `.${fraction}`}`;

    return { negative: written.startsWith("-") && text !== "0", text };
  });

/**
 * The amount a field writes, in minor units of `currency`, read from its digits: exact, never
 * through a float. A sign may lead (`-12.34`, `+12.34`), but never in CAMT.053 and MT940; more decimals than the currency has are refused unless they are zeros (`12.340` is
 * `12.34` in EUR).
 */
export const readAmount = (field: FieldText, currency: string, syntax: AmountSyntax) =>
  Effect.gen(function* () {
    const digits = minorDigits(currency);
    const written = field.text.trim();
    const signed = /^[+-]/.test(written);

    if (signed && (syntax === "camt053" || syntax === "mt940")) {
      return yield* invalidField(field, EXAMPLES[syntax]);
    }

    const negative = written.startsWith("-");
    const unsigned = signed ? written.slice(1).trimStart() : written;
    const split = splitAmount(unsigned, syntax, digits);

    if ("expected" in split) {
      return yield* invalidField(field, split.expected);
    }

    const { whole, fraction } = split;

    if (!/\d/.test(`${whole}${fraction}`)) {
      return yield* invalidField(field, EXAMPLES[syntax]);
    }

    if (!/^0*$/.test(fraction.slice(digits))) {
      return yield* invalidField(
        field,
        `an amount with at most ${String(digits)} decimals, as ${currency} has`,
      );
    }

    const significant = whole.replace(/^0+/, "");

    const tooLarge = invalidField(field, "an amount small enough to be held exactly");

    // More digits than the largest safe integer has: refused before a megabyte of them is read.
    if (significant.length + digits > String(Number.MAX_SAFE_INTEGER).length) {
      return yield* tooLarge;
    }

    const minor = BigInt(`0${significant}${fraction.slice(0, digits).padEnd(digits, "0")}`);

    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      return yield* tooLarge;
    }

    const amount = Number(minor);

    return negative && amount !== 0 ? -amount : amount;
  });
