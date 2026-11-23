import { Effect } from "effect";

import { InvalidField } from "./errors";
import { excerpt, quote } from "./text";

/** A field's text and where it stands in the file, for the error that names it. */
export type FieldText = { field: string; text: string; line: number };

/** The error for a field that cannot be read: its text cut to 40 characters, as written. */
export function invalidField(written: FieldText, expected: string): InvalidField {
  return new InvalidField({ ...written, text: excerpt(written.text), expected });
}

/**
 * How a format writes amounts. `ofx`: an optional sign, digits and at most one decimal mark, `.` or
 * `,` (French banks write a comma), never a thousands separator. `qif`: the same, and thousands
 * may be grouped (`1,234.56`, `1.234,56`, `1 234,56`, `1'234.56`).
 */
export type AmountSyntax = "ofx" | "qif";

const EXAMPLES = {
  ofx: "an amount such as -1234.56 or -1234,56",
  qif: "an amount such as -1,234.56, -1.234,56 or -1234,56",
} satisfies { [syntax in AmountSyntax]: string };

const SEPARATORS = /[.,'   ]/;

// ISO 4217's minor units, where they are not two. Intl's figures come from CLDR, which differ for
// some (IQD 0 there, ALL 0) and from one engine's version to the next; a bank writes ISO's.
const NO_MINOR_UNIT = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_MINOR_DIGITS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

const FOUR_MINOR_DIGITS = new Set(["CLF", "UYW"]);

/** How many minor units a currency has, as ISO 4217 gives them: EUR 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  if (NO_MINOR_UNIT.has(currency)) {
    return 0;
  }

  if (THREE_MINOR_DIGITS.has(currency)) {
    return 3;
  }

  return FOUR_MINOR_DIGITS.has(currency) ? 4 : 2;
}

type Split = { whole: string; fraction: string } | { expected: string };

function splitOfx(unsigned: string): Split {
  const parts = /^(\d*)(?:[.,](\d*))?$/.exec(unsigned);

  if (parts === null) {
    return { expected: EXAMPLES.ofx };
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

/**
 * The amount a field writes, in minor units of `currency`, read from its digits: exact, never
 * through a float. A sign may lead (`-12.34`, `+12.34`); more decimals than the currency has are
 * refused unless they are zeros (`12.340` is `12.34` in EUR).
 */
export const readAmount = (field: FieldText, currency: string, syntax: AmountSyntax) =>
  Effect.gen(function* () {
    const digits = minorDigits(currency);
    const written = field.text.trim();
    const negative = written.startsWith("-");
    const unsigned = /^[+-]/.test(written) ? written.slice(1).trimStart() : written;
    const split = syntax === "ofx" ? splitOfx(unsigned) : splitQif(unsigned, digits);

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
