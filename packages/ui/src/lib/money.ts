// Money as Gousset holds it: an integer of the currency's minor units, with its currency, never a
// float. This file turns it into text for a locale, compares it to a reference, and lays out the
// bars that show it. Pure functions; the components in `components/` draw what they return.

export type Money = { minor: number; currency: string };

export type MoneyFormat = {
  /** A BCP 47 tag ("en", "fr-FR"): the separators, the currency's place, the spaces. */
  locale: string;
  /** `auto`: a minus on negatives only. `always`: a plus on positives too (a refund, a change). */
  sign?: "auto" | "always";
  /** Whole units, rounded half away from zero: `€3,120` in summaries. */
  whole?: boolean;
};

/** The true minus sign (U+2212), wider than a hyphen and as wide as the plus. */
export const MINUS = "−";

/**
 * A minor amount must be a safe integer: anything else is a programming error upstream (a float
 * crept in, a sum overflowed), so it throws rather than shows a wrong figure.
 */
function assertMinor(minor: number) {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`Money is held in integer minor units; got ${String(minor)}.`);
  }
}

const formatters = new Map<string, Intl.NumberFormat>();

function cached(locale: string, options: Intl.NumberFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`;
  const existing = formatters.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const created = new Intl.NumberFormat(locale, options);

  formatters.set(key, created);

  return created;
}

/** How many minor units the currency has, as Intl knows it: EUR 2, JPY 0, KWD 3. */
export function minorDigits(currency: string): number {
  const digits = cached("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits;

  if (digits === undefined) {
    throw new RangeError(`Intl gives no minor units for ${currency}.`);
  }

  return digits;
}

/**
 * Minor units as an exact decimal string (`123450, 2` → `"1234.50"`), the input Intl formats
 * without going through a float: no drift even at `Number.MAX_SAFE_INTEGER`.
 */
export function toDecimalString(minor: number, digits: number): string {
  assertMinor(minor);

  const units = String(Math.abs(minor)).padStart(digits + 1, "0");
  const text = digits === 0 ? units : `${units.slice(0, -digits)}.${units.slice(-digits)}`;

  return minor < 0 ? `-${text}` : text;
}

/** A plain decimal (`-1234.50`, `5E-2`): what Intl formats exactly (ES2023), with no float. */
function isDecimal(text: string): text is Intl.StringNumericLiteral {
  return /^-?\d+(?:\.\d+)?(?:E-?\d+)?$/.test(text);
}

function asNumeric(decimal: string): Intl.StringNumericLiteral {
  if (!isDecimal(decimal)) {
    throw new RangeError(`Not a decimal: ${decimal}.`);
  }

  return decimal;
}

function trueMinus(parts: Array<Intl.NumberFormatPart>): Array<Intl.NumberFormatPart> {
  return parts.map((part) => (part.type === "minusSign" ? { ...part, value: MINUS } : part));
}

/** The pieces of a formatted amount (sign, currency, digits, separators), true minus included. */
export function moneyParts(money: Money, format: MoneyFormat): Array<Intl.NumberFormatPart> {
  const digits = minorDigits(money.currency);
  const fraction = format.whole === true ? 0 : digits;

  const formatter = cached(format.locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
    roundingMode: "halfExpand",
    // "negative" leaves no sign on an amount rounded to zero; "exceptZero" adds the plus.
    signDisplay: format.sign === "always" ? "exceptZero" : "negative",
  });

  return trueMinus(formatter.formatToParts(asNumeric(toDecimalString(money.minor, digits))));
}

/** An amount as text: `€1,234.50` in English, `1 234,50 €` in French, `−€80.00` when negative. */
export function formatMoney(money: Money, format: MoneyFormat): string {
  return moneyParts(money, format)
    .map((part) => part.value)
    .join("");
}

/** A whole percentage as text: `+5%`, `−20%`, `+5 %` in French. */
export function formatPercent(
  percent: number,
  format: { locale: string; sign?: "auto" | "always" },
): string {
  const formatter = cached(format.locale, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: format.sign === "always" ? "exceptZero" : "negative",
  });

  // `5E-2` is exactly 5 %: no float division on the way.
  return trueMinus(formatter.formatToParts(asNumeric(`${String(percent)}E-2`)))
    .map((part) => part.value)
    .join("");
}

export type Comparison = {
  /** `value − reference`, in the same currency. */
  change: Money;
  /**
   * The change against the reference's size, as a whole percentage rounded half away from zero
   * (2.5 % → 3 %, −2.5 % → −3 %), signed as the change. `null` when the reference is zero: a
   * percentage of nothing means nothing. From a positive reference to a value of zero or more it
   * is never under −100.
   */
  percent: number | null;
};

/** A value against its reference (last month, a 6-month average). Both in the same currency. */
export function compare(value: Money, reference: Money): Comparison {
  if (value.currency !== reference.currency) {
    throw new RangeError(`Cannot compare ${value.currency} with ${reference.currency}.`);
  }

  assertMinor(value.minor);
  assertMinor(reference.minor);

  const change = value.minor - reference.minor;

  assertMinor(change);

  if (reference.minor === 0) {
    return { change: { minor: change, currency: value.currency }, percent: null };
  }

  const exact = (change / Math.abs(reference.minor)) * 100;
  // `+ 0` turns a negative zero into zero.
  const percent = Math.sign(exact) * Math.round(Math.abs(exact)) + 0;

  return { change: { minor: change, currency: value.currency }, percent };
}

/** Nearly no change: the percentage rounds to 0 %, or nothing changed against nothing. */
export function isSteady(comparison: Comparison): boolean {
  return comparison.percent === null ? comparison.change.minor === 0 : comparison.percent === 0;
}

/** One piece of the digits' roll: a digit that rolls in its column, or text that stays. */
export type RollSlot = { key: string; digit: number | null; text: string };

/**
 * The formatted parts cut into slots for the roll. A digit's key is its place from the decimal
 * point (units, tens…, tenths…), so that the same column keeps rolling from one value to the
 * next even when the number of digits changes.
 */
export function rollSlots(parts: Array<Intl.NumberFormatPart>): Array<RollSlot> {
  const integerDigits = parts
    .filter((part) => part.type === "integer")
    .reduce((count, part) => count + part.value.length, 0);

  const slots: Array<RollSlot> = [];
  const seen = new Map<string, number>();
  let integerPlace = integerDigits;
  let fractionPlace = 0;

  for (const part of parts) {
    if (part.type === "integer" || part.type === "fraction") {
      for (const character of part.value) {
        const key =
          part.type === "integer"
            ? `i${String((integerPlace -= 1))}`
            : `f${String(fractionPlace++)}`;

        slots.push({ key, digit: Number(character), text: character });
      }
    } else {
      const count = seen.get(part.type) ?? 0;

      seen.set(part.type, count + 1);
      slots.push({ key: `${part.type}${String(count)}`, digit: null, text: part.value });
    }
  }

  return slots;
}

/** A share of a bar, as the percentage SVG takes in `width` and `x`. */
function share(part: number, whole: number) {
  return whole <= 0 ? 0 : Math.min(100, Math.max(0, (part / whole) * 100));
}

export type MoneyRole = "spent" | "saved" | "left";

export type MonthBarLayout = {
  /** Each part's start and width, in percent of the bar, in order. */
  parts: Array<{ role: MoneyRole; x: number; width: number }>;
  /** Where the money received ends, when more went out than came in; null otherwise. */
  receivedMark: number | null;
  overspent: boolean;
};

/**
 * The month bar's geometry. The bar is the money received, cut into spent, set aside and left.
 * When more went out than came in, the bar stretches to what went out, the part left is empty,
 * and a mark shows where the money received ended.
 */
export function monthBarLayout(figures: {
  received: Money;
  spent: Money;
  saved: Money;
  left: Money;
}): MonthBarLayout {
  const spent = Math.max(0, figures.spent.minor);
  const saved = Math.max(0, figures.saved.minor);
  const left = Math.max(0, figures.left.minor);
  const received = Math.max(0, figures.received.minor);
  const out = spent + saved;
  const overspent = out > received;
  const whole = Math.max(received, out + left);
  const spentWidth = share(spent, whole);
  const savedWidth = share(saved, whole);

  return {
    parts: [
      { role: "spent", x: 0, width: spentWidth },
      { role: "saved", x: spentWidth, width: savedWidth },
      { role: "left", x: spentWidth + savedWidth, width: share(left, whole) },
    ],
    receivedMark: overspent ? share(received, whole) : null,
    overspent,
  };
}

/** The locale's group and decimal separators, read from a sample it formats itself. */
function inputSeparators(locale: string) {
  const parts = cached(locale, { style: "decimal", minimumFractionDigits: 1 }).formatToParts(
    1111.1,
  );

  return {
    group: parts.find((part) => part.type === "group")?.value ?? ",",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/**
 * Minor units as text to edit (an opening balance typed into a form): no currency symbol, the
 * locale's separators, as many decimals as the currency takes. The counterpart a user reads while
 * typing; `formatMoney` is for display.
 */
export function formatMoneyInput(minor: number, options: { locale: string; currency: string }) {
  const digits = minorDigits(options.currency);

  const formatter = cached(options.locale, {
    style: "decimal",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    roundingMode: "halfExpand",
  });

  return trueMinus(formatter.formatToParts(asNumeric(toDecimalString(minor, digits))))
    .map((part) => part.value)
    .join("");
}

/**
 * Minor units parsed back from typed text, in the locale's separators (a typed hyphen-minus
 * counts as the true minus): `null` for empty or unreadable text. Extra decimals are cut, not
 * rounded; `Number.isSafeInteger` guards the largest amounts.
 */
export function parseMoneyInput(
  text: string,
  options: { locale: string; currency: string },
): number | null {
  const trimmed = text.trim();

  if (trimmed === "") {
    return null;
  }

  const negative = trimmed.startsWith("-") || trimmed.startsWith(MINUS);
  const body = negative ? trimmed.slice(1) : trimmed;
  const { group, decimal } = inputSeparators(options.locale);
  // Every locale's group separator is some kind of space or a comma/dot; stripping whitespace
  // outright reads a value typed with a plain space even where the locale uses a narrow one.
  const withoutSpaces = body.replaceAll(/[\s  ]/gu, "");
  const withoutGroups = group.trim() === "" ? withoutSpaces : withoutSpaces.split(group).join("");
  const normalized = withoutGroups.split(decimal).join(".");

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const digits = minorDigits(options.currency);
  const [whole, fraction = ""] = normalized.split(".");
  const fractionDigits = `${fraction}${"0".repeat(digits)}`.slice(0, digits);
  const minor = Number(`${whole}${fractionDigits}`);

  if (!Number.isSafeInteger(minor)) {
    return null;
  }

  return negative ? -minor : minor;
}

export type BreakdownBar = {
  /** The bar's width, in percent of the row's track. */
  width: number;
  /** The benchmark's place, in percent of the track; null without a benchmark. */
  mark: number | null;
  /** Spent more than the benchmark. */
  over: boolean;
};

/**
 * The bars of a breakdown, on one scale: the largest amount or benchmark of every row (shown or
 * cut) fills the track, so rows compare with each other.
 */
export function breakdownBars(
  rows: ReadonlyArray<{ amount: Money; benchmark?: Money }>,
): Array<BreakdownBar> {
  const largest = rows.reduce(
    (most, row) => Math.max(most, row.amount.minor, row.benchmark?.minor ?? 0),
    0,
  );

  return rows.map((row) => ({
    width: share(row.amount.minor, largest),
    mark: row.benchmark === undefined ? null : share(row.benchmark.minor, largest),
    over: row.benchmark !== undefined && row.amount.minor > row.benchmark.minor,
  }));
}
