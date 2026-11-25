// Which lines are the two sides of one transfer (docs/data-model.md, v0.3, `transfer`; #26): the
// rules alone, on lines already read, so that the import's pairing, the pairing on demand and the
// line's detail all decide alike.

import type { AccountKind } from "../account-values";

/** How many days apart the two sides of a transfer may be booked: a few, as banks book them. */
export const TRANSFER_DAYS = 4;

/**
 * The kinds whose banks date money in and out by fortnights (docs/data-model.md, `transfer`): a
 * side on one may be booked as late as the next fortnight's start, plus `TRANSFER_DAYS`.
 */
const BY_FORTNIGHT: ReadonlySet<AccountKind> = new Set(["savings"]);

/** How many days apart two sides may be at most: a fortnight starts 16 days after a day at most. */
export const LONGEST_TRANSFER_DAYS = 16 + TRANSFER_DAYS;

/** How many days before its debit a deferred card's balance may have been what the debit pays. */
export const CARD_DAYS = 35;

/** A counted line that is no side of a transfer yet, with its account's currency. */
export type PairableLine = {
  readonly id: string;
  readonly accountId: string;
  readonly accountKind: AccountKind;
  readonly currency: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly amountMinor: number;
};

/** Two lines paired: the one money left by, and the one it came in by. */
export type Pair = { readonly outLineId: string; readonly inLineId: string };

const DAY_MS = 86_400_000;

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** Days from `day`, `YYYY-MM-DD`. */
export function shiftDay(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** How far apart two lines are: by booking date, or by value date when both have one and it is closer. */
function daysApart(a: PairableLine, b: PairableLine): number {
  const booked = Math.abs(dayNumber(a.bookedOn) - dayNumber(b.bookedOn));

  return a.valueOn === null || b.valueOn === null
    ? booked
    : Math.min(booked, Math.abs(dayNumber(a.valueOn) - dayNumber(b.valueOn)));
}

/** The day the fortnight after `day`'s starts: the 16th, or the 1st of the next month. */
function nextFortnight(day: string): string {
  if (Number(day.slice(8, 10)) < 16) {
    return `${day.slice(0, 8)}16`;
  }

  // Months count from 0 here: the month of `day` names the next one.
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * Whether two days are close enough for a transfer's two sides: `TRANSFER_DAYS` apart, or, by the
 * fortnight, the later no more than `TRANSFER_DAYS` after the start of the earlier's next fortnight.
 */
function closeDays(a: string, b: string, byFortnight: boolean): boolean {
  const [early, late] = a <= b ? [a, b] : [b, a];

  return (
    dayNumber(late) - dayNumber(early) <= TRANSFER_DAYS ||
    (byFortnight && late <= shiftDay(nextFortnight(early), TRANSFER_DAYS))
  );
}

/**
 * Whether two lines are close enough, by booking date, or by value date when both have one: by the
 * fortnight when one side's account dates by it, unless `fortnights` is `never`.
 */
function closeEnough(
  a: PairableLine,
  b: PairableLine,
  fortnights: "when either dates by it" | "never" = "when either dates by it",
): boolean {
  const byFortnight =
    fortnights === "when either dates by it" &&
    (BY_FORTNIGHT.has(a.accountKind) || BY_FORTNIGHT.has(b.accountKind));

  return (
    closeDays(a.bookedOn, b.bookedOn, byFortnight) ||
    (a.valueOn !== null && b.valueOn !== null && closeDays(a.valueOn, b.valueOn, byFortnight))
  );
}

/**
 * Whether two lines may be the two sides of one transfer: on two accounts in the same currency, of
 * opposite amounts, booked a few days apart (`TRANSFER_DAYS`), or up to the next fortnight when
 * one side is on an account that dates by the fortnight (`BY_FORTNIGHT`).
 */
export function isCandidate(a: PairableLine, b: PairableLine): boolean {
  return (
    a.id !== b.id &&
    a.accountId !== b.accountId &&
    a.currency === b.currency &&
    a.amountMinor !== 0 &&
    a.amountMinor === -b.amountMinor &&
    closeEnough(a, b)
  );
}

/** The lines of `pool` that may be the other side of `line`, nearest first. */
export function candidatesOf<Line extends PairableLine>(
  line: PairableLine,
  pool: ReadonlyArray<Line>,
): ReadonlyArray<Line> {
  return pool
    .filter((other) => isCandidate(line, other))
    .toSorted(
      (a, b) =>
        daysApart(line, a) - daysApart(line, b) ||
        a.bookedOn.localeCompare(b.bookedOn) ||
        a.id.localeCompare(b.id),
    );
}

const amountKey = (line: PairableLine) => `${line.currency} ${Math.abs(line.amountMinor)}`;

/**
 * The candidates the automatic pairing weighs (#131): those within `TRANSFER_DAYS` when there are
 * any, as before the fortnight; the fortnight's farther ones only for a line with none that near,
 * so that a weekly transfer to a savings account still pairs each line with its own day's.
 */
function nearestTier<Line extends PairableLine>(
  line: PairableLine,
  candidates: ReadonlyArray<Line>,
): ReadonlyArray<Line> {
  const near = candidates.filter((other) => closeEnough(line, other, "never"));

  return near.length > 0 ? near : candidates;
}

/**
 * The candidates the automatic pairing weighs for each line of one pool, read many times (the
 * line's detail offers them all, `candidatesOf`): the pool is grouped once by currency and amount,
 * so that pairing every line of a user's stays linear.
 */
export function candidateFinder<Line extends PairableLine>(
  pool: ReadonlyArray<Line>,
): (line: PairableLine) => ReadonlyArray<Line> {
  const groups = new Map<string, Array<Line>>();

  for (const line of pool) {
    const group = groups.get(amountKey(line)) ?? [];

    group.push(line);
    groups.set(amountKey(line), group);
  }

  return (line) => nearestTier(line, candidatesOf(line, groups.get(amountKey(line)) ?? []));
}

const pairOf = (a: PairableLine, b: PairableLine): Pair =>
  a.amountMinor < 0 ? { outLineId: a.id, inLineId: b.id } : { outLineId: b.id, inLineId: a.id };

/**
 * The transfers `fresh` lines make with the lines of `pool` (which holds `fresh` too): a line and
 * its only candidate, when it is that candidate's only one too. A line with several candidates, or
 * whose candidate has several, is paired with none: it waits for the user.
 */
export function clearPairs(
  fresh: ReadonlyArray<PairableLine>,
  pool: ReadonlyArray<PairableLine>,
): ReadonlyArray<Pair> {
  const pairs: Array<Pair> = [];
  const paired = new Set<string>();
  const candidates = candidateFinder(pool);

  for (const line of fresh) {
    if (paired.has(line.id)) {
      continue;
    }

    const [only, ...others] = candidates(line);

    if (only === undefined || others.length > 0 || paired.has(only.id)) {
      continue;
    }

    // The line must be its candidate's only one too: a far candidate may have a near one of its own.
    const [back, ...more] = candidates(only);

    if (back?.id === line.id && more.length === 0) {
      pairs.push(pairOf(line, only));
      paired.add(line.id);
      paired.add(only.id);
    }
  }

  return pairs;
}

/** A line's part of an entry, and who classified that entry. */
export type LinePart = {
  readonly lineId: string;
  readonly classifiedBy: "default" | "rule" | "user";
};

/**
 * The lines the user decided (#192): a line whose entry the user classified, or a rule of the user's
 * did (at an import, or applied to the past), or which the user split across several entries. The
 * pairing at boot never pairs them; the user may, by hand.
 */
export function decidedLines(parts: ReadonlyArray<LinePart>): ReadonlySet<string> {
  const seen = new Set<string>();
  const decided = new Set<string>();

  for (const part of parts) {
    if (part.classifiedBy !== "default" || seen.has(part.lineId)) {
      decided.add(part.lineId);
    }

    seen.add(part.lineId);
  }

  return decided;
}

/**
 * The pairs the pairing at boot makes (#192): `clearPairs`, but never with a line the user decided.
 * Such a line stays in `pool`, a candidate as any other, so that a line it makes ambiguous is never
 * paired with its other candidate by a guess.
 */
export function keptPairs(
  fresh: ReadonlyArray<PairableLine>,
  pool: ReadonlyArray<PairableLine>,
  decided: ReadonlySet<string>,
): ReadonlyArray<Pair> {
  return clearPairs(
    fresh.filter((line) => !decided.has(line.id)),
    pool,
  ).filter((pair) => !decided.has(pair.outLineId) && !decided.has(pair.inLineId));
}

/** A deferred-debit card's lines around its debits, to tell what it owed on each day. */
export type CardLedger = {
  readonly accountId: string;
  readonly currency: string;
  /** The current account it is debited from. */
  readonly settlesInto: string;
  /** Its balance before its first line in `lines`: the opening balance and every line before. */
  readonly balanceBefore: number;
  /** Its counted lines from then on. */
  readonly lines: ReadonlyArray<{ readonly bookedOn: string; readonly amountMinor: number }>;
};

/** The days a balance held at their end: from `since`, up to `until` (excluded; null: still). */
type Span = { readonly since: string; readonly until: string | null };

/** Each balance the card had at the end of a day, and the days it had it. */
function owedOf(card: CardLedger): ReadonlyMap<number, ReadonlyArray<Span>> {
  const ordered = card.lines.toSorted((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  const owed = new Map<number, Array<Span>>();

  const hold = (balance: number, span: Span) => {
    const spans = owed.get(balance) ?? [];

    spans.push(span);
    owed.set(balance, spans);
  };

  let balance = card.balanceBefore;
  let since = "0000-01-01";

  for (const each of ordered) {
    // A new day: the balance before it held at the end of every day since the last change.
    if (each.bookedOn !== since) {
      hold(balance, { since, until: each.bookedOn });
      since = each.bookedOn;
    }

    balance += each.amountMinor;
  }

  hold(balance, { since, until: null });

  return owed;
}

/** Whether the card owed `amountMinor` at the end of one of the days from `from` to `to`. */
const owedBetween = (
  owed: ReadonlyMap<number, ReadonlyArray<Span>>,
  amountMinor: number,
  from: string,
  to: string,
) =>
  (owed.get(amountMinor) ?? []).some(
    (span) => span.since <= to && (span.until === null || span.until > from),
  );

/** A current account's line that pays a deferred card's balance, and that card. */
export type CardDebit = { readonly lineId: string; readonly cardAccountId: string };

/**
 * The debits among `lines` that pay one card's balance (docs/data-model.md, v0.3: a deferred card's
 * monthly debit is a transfer from the current account to the card): a line out of the account a
 * card settles into, whose amount is what that card owed at the end of one of the `CARD_DAYS` days
 * before it. A debit two cards could be paying is left for the user.
 */
export function cardDebits(
  lines: ReadonlyArray<PairableLine>,
  cards: ReadonlyArray<CardLedger>,
): ReadonlyArray<CardDebit> {
  const owed = new Map(cards.map((card) => [card.accountId, owedOf(card)]));

  return lines.flatMap((line) => {
    if (line.amountMinor >= 0) {
      return [];
    }

    const paid = cards.filter(
      (card) =>
        card.settlesInto === line.accountId &&
        card.currency === line.currency &&
        owedBetween(
          owed.get(card.accountId) ?? new Map(),
          line.amountMinor,
          shiftDay(line.bookedOn, -CARD_DAYS),
          line.bookedOn,
        ),
    );

    const [card, ...others] = paid;

    return card === undefined || others.length > 0
      ? []
      : [{ lineId: line.id, cardAccountId: card.accountId }];
  });
}

/**
 * The sides the app made that the pairing at boot replaces (#192): `replacedCounterparts`, weighed
 * among every line, but never by a line the user decided.
 */
export function keptReplacements(
  fresh: ReadonlyArray<PairableLine>,
  counterparts: ReadonlyArray<PairableLine>,
  decided: ReadonlySet<string>,
): ReadonlyArray<Replacement> {
  return replacedCounterparts(fresh, counterparts).filter(
    (replacement) => !decided.has(replacement.lineId),
  );
}

/** A line the app made for a transfer's side, and the line of the account's own file that is it. */
export type Replacement = { readonly counterpartId: string; readonly lineId: string };

/**
 * How many days apart a card's own line of its payment and the side the app made on the debit's day
 * may be: a card statement may book its payment before the current account does, or a week after.
 */
export const REPLACE_DAYS = 10;

/**
 * The lines the app made for a side no file showed (`source = counterpart`) that a later file now
 * brings: the same account and amount, at most `REPLACE_DAYS` apart, each the other's only match.
 */
export function replacedCounterparts(
  fresh: ReadonlyArray<PairableLine>,
  counterparts: ReadonlyArray<PairableLine>,
): ReadonlyArray<Replacement> {
  const matches = (a: PairableLine, b: PairableLine) =>
    a.accountId === b.accountId &&
    a.amountMinor === b.amountMinor &&
    daysApart(a, b) <= REPLACE_DAYS;

  return fresh.flatMap((line) => {
    const [made, ...others] = counterparts.filter((counterpart) => matches(line, counterpart));

    return made === undefined ||
      others.length > 0 ||
      fresh.filter((each) => matches(each, made)).length > 1
      ? []
      : [{ counterpartId: made.id, lineId: line.id }];
  });
}
