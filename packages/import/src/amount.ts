import { Effect } from "effect";

import { InvalidField } from "./errors";

/** A field's text and where it stands in the file, for the error that names it. */
export type FieldText = { field: string; text: string; line: number };

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

/** How many minor units a currency has, as Intl knows it: EUR 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });

  return format.resolvedOptions().maximumFractionDigits ?? 2;
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
 * guessing would put a wrong amount in the ledger, so it is refused (but in a currency of three
 * minor units, where it can only be a decimal mark).
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
    return { expected: `${EXAMPLES.qif}: "${unsigned}" may be a thousand or a fraction` };
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
      return yield* new InvalidField({ ...field, expected: split.expected });
    }

    const { whole, fraction } = split;

    if (!/\d/.test(`${whole}${fraction}`)) {
      return yield* new InvalidField({ ...field, expected: EXAMPLES[syntax] });
    }

    if (!/^0*$/.test(fraction.slice(digits))) {
      return yield* new InvalidField({
        ...field,
        expected: `an amount with at most ${String(digits)} decimals, as ${currency} has`,
      });
    }

    const minor = BigInt(`0${whole}${fraction.slice(0, digits).padEnd(digits, "0")}`);

    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      return yield* new InvalidField({
        ...field,
        expected: "an amount small enough to be held exactly",
      });
    }

    const amount = Number(minor);

    return negative && amount !== 0 ? -amount : amount;
  });
