import { minorDigits } from "@gousset/import";
import { Effect, Result } from "effect";

import type { LineCategory } from "./category-store";
import type { NamedMerchant } from "./merchants/line-merchant";
import { LineNotFound, LineSearchRefused } from "./errors";
import { LineStore } from "./line-store";
import type { AmountBounds, FoundLine, LineQuery } from "./line-store";
import type { Money } from "./month";
import { today } from "./today";

// Every line of every account, searched and read for the operations page and the MCP door alike
// (#21). What a search means is decided here; the store only reads.

/** What a search of the lines asks for; every field may be left out. */
export type LineSearch = {
  /**
   * A piece of the label, memo or counterparty's name, any case; `%`, `_` and `\` are themselves.
   * Blank for none.
   */
  readonly text?: string;
  /** One account's lines; an id that names none of the user's accounts gives no line. */
  readonly accountId?: string;
  /** Booked on or after this day, `YYYY-MM-DD`. */
  readonly from?: string;
  /** Booked on or before this day, `YYYY-MM-DD`. */
  readonly to?: string;
  /**
   * The least amount, a decimal in major units ("12.5"), against the line's absolute amount in its
   * account's currency; rounded up to that currency's minor units.
   */
  readonly amountMin?: string;
  /** The greatest amount, the same way; rounded down. */
  readonly amountMax?: string;
  /**
   * True: the lines to review only: held as near duplicates, counted lines that wait for the user to
   * choose their transfer's other side among several (#26), and counted lines whose entry is still
   * where the import put it, in its kind's fallback (#23). Otherwise the counted ones. Discarded
   * lines never.
   */
  readonly toReview?: boolean;
  /** The `next` of the page before. */
  readonly after?: string;
  /** How many lines: 100 by default, 1 to 500. */
  readonly limit?: number;
};

export type LineAccount = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
};

/** A line as the operations page lists it. */
export type LineRow = {
  readonly id: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly label: string;
  readonly memo: string | null;
  readonly counterpartyName: string | null;
  readonly amount: Money;
  readonly account: LineAccount;
  /**
   * Held as a near duplicate; or, in a search of the lines to review, any line it gives (a
   * transfer's side to choose among several, a line not classified yet): waiting for the user.
   */
  readonly toReview: boolean;
  /**
   * The category of its one entry (with its parent's name, for a child); null for a line with none
   * (held, of no amount) or split across several.
   */
  readonly category: LineCategory | null;
  /**
   * Who it paid, with its look (#204): its one entry's merchant, else its cleaned label's, when
   * that is no payment intermediary; null for none known.
   */
  readonly merchant: NamedMerchant | null;
  /** The movement a noted balance makes (#31): it has no label, the interface names it. */
  readonly fromBalance: boolean;
  /**
   * Maybe a refund (#208): a line coming back that may cancel an expense, still classified by
   * default, that the user has not answered. It counts as no income until answered: confirmed, it
   * is linked as a refund; refused, it is an ordinary income.
   */
  readonly maybeRefund: boolean;
};

export type LinePage = {
  /** Newest first: booked on, then id. */
  readonly lines: ReadonlyArray<LineRow>;
  /** Give it as `after` for the next page; null on the last one. */
  readonly next: string | null;
  /** How many lines match in all, whatever the page. */
  readonly total: number;
};

/** A line with all that is known of it. */
export type LineDetail = LineRow & {
  /** What was paid in another currency, when the bank says so. */
  readonly originalAmount: Money | null;
  readonly counterpartyIban: string | null;
  /** A benefit account's credit: the day it expires. */
  readonly expiresOn: string | null;
  readonly source: "import" | "manual" | "balance" | "counterpart";
  /** A held line: the line it looks like. */
  readonly duplicateOf: {
    readonly id: string;
    readonly bookedOn: string;
    readonly label: string;
    readonly amount: Money;
  } | null;
  /** The import that read it. */
  readonly import: {
    readonly id: string;
    readonly fileName: string;
    readonly format: string;
    /** When the file was dropped, ISO 8601. */
    readonly importedAt: string;
    readonly periodFrom: string | null;
    readonly periodTo: string | null;
  } | null;
};

export const DEFAULT_SEARCH_LINES = 100;
export const MAX_SEARCH_LINES = 500;

/** Beyond 11 digits of units, a bound in minor units of four digits would pass 2⁵³. */
const DECIMAL = /^[+-]?(\d{1,11})(?:[.,](\d+))?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const CURSOR = /^(\d{4}-\d{2}-\d{2})_(.+)$/;

/** An exact decimal: `value` × 10^-`scale`. */
type Decimal = { readonly value: bigint; readonly scale: number };

/** A decimal in major units, its sign dropped: the bounds are against the absolute amount. */
function decimalOf(text: string): Decimal | undefined {
  const match = DECIMAL.exec(text.trim());

  if (match === null) {
    return undefined;
  }

  const units = match[1] ?? "0";
  const fraction = match[2] ?? "";

  return { value: BigInt(units + fraction), scale: fraction.length };
}

const TEN = BigInt(10);

const above = (a: Decimal, b: Decimal) =>
  a.value * TEN ** BigInt(b.scale) > b.value * TEN ** BigInt(a.scale);

/** A decimal in minor units of `digits`, rounded up or down to a whole one. */
function minorOf(decimal: Decimal, digits: number, rounding: "up" | "down"): number {
  if (decimal.scale <= digits) {
    return Number(decimal.value * TEN ** BigInt(digits - decimal.scale));
  }

  const divisor = TEN ** BigInt(decimal.scale - digits);
  const whole = decimal.value / divisor;
  const rest = decimal.value % divisor;

  return Number(rounding === "up" && rest > BigInt(0) ? whole + BigInt(1) : whole);
}

/** The bounds in each currency: none it can meet when its rounding leaves the minimum above. */
function boundsOf(min: Decimal | undefined, max: Decimal | undefined) {
  return (currency: string): AmountBounds | null => {
    const digits = minorDigits(currency);
    const minMinor = min === undefined ? null : minorOf(min, digits, "up");
    const maxMinor = max === undefined ? null : minorOf(max, digits, "down");

    return minMinor !== null && maxMinor !== null && minMinor > maxMinor
      ? null
      : { minMinor, maxMinor };
  };
}

function isDay(text: string): boolean {
  if (!DAY.test(text)) {
    return false;
  }

  const date = new Date(`${text}T00:00:00Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const cursorOf = (line: FoundLine) => `${line.bookedOn}_${line.id}`;

function afterOf(cursor: string) {
  const match = CURSOR.exec(cursor);
  const bookedOn = match?.[1];
  const id = match?.[2];

  return bookedOn === undefined || id === undefined || !isDay(bookedOn) || !UUID.test(id)
    ? undefined
    : { bookedOn, id };
}

const refused = (reason: LineSearchRefused["reason"]) =>
  Result.fail(new LineSearchRefused({ reason }));

const blank = (text: string | undefined) => text === undefined || text.trim() === "";

function amountOf(search: LineSearch): Result.Result<LineQuery["amount"], LineSearchRefused> {
  const min = blank(search.amountMin) ? undefined : decimalOf(search.amountMin ?? "");
  const max = blank(search.amountMax) ? undefined : decimalOf(search.amountMax ?? "");

  if (
    (!blank(search.amountMin) && min === undefined) ||
    (!blank(search.amountMax) && max === undefined)
  ) {
    return refused("amount");
  }

  if (min !== undefined && max !== undefined && above(min, max)) {
    return refused("amount");
  }

  return Result.succeed(min === undefined && max === undefined ? null : boundsOf(min, max));
}

function limitOf(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_SEARCH_LINES;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LINES);
}

/** The query a search asks the store, as of `day`, or why it cannot be read. */
function queryOf(search: LineSearch, day: string): Result.Result<LineQuery, LineSearchRefused> {
  const { from, to } = search;

  if ((from !== undefined && !isDay(from)) || (to !== undefined && !isDay(to))) {
    return refused("period");
  }

  if (from !== undefined && to !== undefined && from > to) {
    return refused("period");
  }

  const after =
    search.after === undefined || search.after.trim() === "" ? null : afterOf(search.after);

  if (after === undefined) {
    return refused("cursor");
  }

  const amount = amountOf(search);

  if (Result.isFailure(amount)) {
    return Result.fail(amount.failure);
  }

  const text = search.text?.trim() ?? "";

  return Result.succeed({
    text: text === "" ? null : text,
    accountId: search.accountId ?? null,
    from: from ?? null,
    // As on the account page, a line booked after today is not shown: it is not counted in any
    // balance yet either (./accounts, `showAccount`).
    to: to === undefined || to > day ? day : to,
    amount: amount.success,
    state: search.toReview === true ? "held" : "counted",
    alsoLineIds: [],
    after,
    limit: limitOf(search.limit),
  });
}

const money = (minor: number, currency: string): Money => ({ minor, currency });

/** A line as a search gives it: to review when it is held, or among the lines to review. */
export function rowOf(line: FoundLine, reviewing = false): LineRow {
  return {
    id: line.id,
    bookedOn: line.bookedOn,
    valueOn: line.valueOn,
    label: line.label,
    memo: line.memo,
    counterpartyName: line.counterpartyName,
    amount: money(line.amountMinor, line.account.currency),
    account: {
      id: line.account.id,
      name: line.account.name,
      institution: line.account.institution,
    },
    toReview: line.state === "held" || reviewing,
    category: line.category,
    merchant: line.merchant,
    fromBalance: line.fromBalance,
    maybeRefund: line.maybeRefund,
  };
}

/**
 * Every line of the user's that matches `search`, across accounts, newest first, a page at a time
 * (keyset on booked on and id: a line added meanwhile never shifts a page), with how many match in
 * all. Fails with `LineSearchRefused` for an amount, a period or a cursor that cannot be read.
 */
export const searchLines = (owner: string, search: LineSearch = {}) =>
  Effect.map(findLines(owner, search), (found) => {
    const page: LinePage = {
      lines: found.lines.map((line) => rowOf(line, search.toReview === true)),
      next: found.next,
      total: found.total,
    };

    return page;
  });

/**
 * A page of `searchLines`, its lines as the store found them, with those among them that wait for
 * the user to choose their transfer's other side (`toChoose`): what the review proposes reads it
 * (`./review-queue`, #35), so that the queue and the filter "to review" are one definition.
 */
export const findLines = (owner: string, search: LineSearch = {}) =>
  Effect.gen(function* () {
    const store = yield* LineStore;
    const day = yield* today;
    const query = yield* Effect.fromResult(queryOf(search, day));

    // To review: the lines held, those whose transfer's other side the user must choose, and those
    // not classified yet (the store's).
    const reviewing = query.state === "held";
    const toChoose = reviewing ? yield* store.severalCandidates(owner, day) : [];

    const found = yield* store.search(owner, {
      ...query,
      alsoLineIds: toChoose,
      limit: query.limit + 1,
    });

    const lines = found.lines.slice(0, query.limit);
    const last = lines.at(-1);

    return {
      lines,
      next: found.lines.length > query.limit && last !== undefined ? cursorOf(last) : null,
      total: found.total,
      toChoose: new Set(toChoose),
    };
  });

/**
 * One line of the user's as the lines to review give it, by the same definition as
 * `searchLines` with `toReview` (#35); undefined when it is none of them (classified, paired,
 * discarded, booked after today, or no line of the user's). `waitsForTransfer`: its transfer's
 * other side is the user's to choose.
 */
export const lineToReview = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const store = yield* LineStore;
    const day = yield* today;
    const toChoose = yield* store.severalCandidates(owner, day);

    const found = yield* store.search(owner, {
      text: null,
      accountId: null,
      from: null,
      to: day,
      amount: null,
      state: "held",
      alsoLineIds: toChoose,
      onlyLineIds: [lineId],
      after: null,
      limit: 1,
    });

    const [line] = found.lines;

    return line === undefined ? undefined : { line, waitsForTransfer: toChoose.includes(lineId) };
  });

/**
 * One line of the user's, counted or held, with its detail: the amount in another currency, the
 * line a held one looks like, the import that read it. A line booked after today, or discarded,
 * is not shown. Fails with `LineNotFound`.
 */
export const showLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const store = yield* LineStore;
    const day = yield* today;
    const line = yield* store.show(owner, lineId, day);

    if (line === undefined) {
      return yield* new LineNotFound({ lineId });
    }

    const detail: LineDetail = {
      ...rowOf(line),
      originalAmount:
        line.originalAmountMinor === null || line.originalCurrency === null
          ? null
          : money(line.originalAmountMinor, line.originalCurrency),
      counterpartyIban: line.counterpartyIban,
      expiresOn: line.expiresOn,
      source: line.source,
      duplicateOf:
        line.duplicateOf === null
          ? null
          : {
              id: line.duplicateOf.id,
              bookedOn: line.duplicateOf.bookedOn,
              label: line.duplicateOf.label,
              amount: money(line.duplicateOf.amountMinor, line.duplicateOf.currency),
            },
      import: line.import,
    };

    return detail;
  });
