import { madeUpMonth, monthParts } from "@gousset/fixture";
import type { Investment, Line, MadeUpMonth } from "@gousset/fixture";
import { Context, Effect, Layer } from "effect";

import { LineAlreadyReviewed, LineNotFound, MonthOutOfRange } from "./errors";
import { today } from "./today";
import { addMonths } from "./values";

/** How far from today's month a month may be read: ten years either way. */
export const MONTHS_FROM_TODAY = 120;

/** The made-up months kept generated, the least recently read dropped first. */
export const CACHED_MONTHS = 36;

/**
 * Where a user's money is read and changed. v0.1 has no tables of its own yet: `FixtureLedger`
 * serves the shared made-up data, the same for every user, and keeps each user's reviews in the
 * process's memory. The database's ledger replaces that layer once the data model exists; the read
 * functions (`./month`) stay as they are.
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    /**
     * The user's month, as it stands today: nothing booked after today, reviews applied. Fails
     * with `MonthOutOfRange` more than ten years from today.
     */
    readonly month: (owner: string, month: string) => Effect.Effect<MadeUpMonth, MonthOutOfRange>;
    /** Marks a line waiting in the review as reviewed. */
    readonly markReviewed: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<Line, LineNotFound | LineAlreadyReviewed>;
  }
>()("@gousset/core/Ledger") {}

/** A line's month, from its id (`2026-10-l07`), when the id has one. */
function monthOfLine(lineId: string): string | undefined {
  const month = lineId.slice(0, 7);

  try {
    monthParts(month);

    return month;
  } catch {
    return undefined;
  }
}

/** `2026-10-31`: the month's last day. */
export function lastDayOf(month: string): string {
  const { year, month: number } = monthParts(month);

  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

/**
 * The investment positions on `day`. The made-up positions are valued at the end of each month:
 * until the month is over, a position is the one of the previous month's end, with what was put in
 * since at cost, and no growth yet. A month not begun has none.
 */
function positionsOn(
  made: MadeUpMonth,
  lines: ReadonlyArray<Line>,
  day: string,
  previous: ReadonlyArray<Investment>,
): ReadonlyArray<Investment> {
  if (lastDayOf(made.month) <= day) {
    return made.investments;
  }

  if (`${made.month}-01` > day) {
    return [];
  }

  const investment = new Set(
    made.accounts.flatMap((account) => (account.kind === "investment" ? [account.id] : [])),
  );

  const putIn = new Map<string, number>();

  for (const line of lines) {
    if (line.kind === "transfer" && investment.has(line.accountId)) {
      putIn.set(line.accountId, (putIn.get(line.accountId) ?? 0) + line.amountMinor);
    }
  }

  // The made-up investment account holds one position: what was put in goes to it.
  return previous.map((position) => {
    const added = putIn.get(position.accountId) ?? 0;

    return {
      ...position,
      netContributionsMinor: position.netContributionsMinor + added,
      valueMinor: position.valueMinor + added,
    };
  });
}

/**
 * The month as it stands on `day`: the lines booked by then, and the expenses paid by then, each
 * made only of those lines and at the net cost they give (a refund booked later does not count
 * yet); the investments as `positionsOn` gives them, from `previous`, the positions at the end of
 * the month before; and no statement in a month not begun.
 */
export function monthAsOf(
  made: MadeUpMonth,
  day: string,
  previous: ReadonlyArray<Investment>,
): MadeUpMonth {
  const lines = made.lines.filter((line) => line.bookedOn <= day);
  const amountOf = new Map(lines.map((line) => [line.id, line.amountMinor]));
  const booked = (id: string) => amountOf.has(id);

  const sum = (ids: ReadonlyArray<string>) =>
    ids.reduce((total, id) => total + (amountOf.get(id) ?? 0), 0);

  const expenses = made.expenses.flatMap((expense) => {
    const paymentLineIds = expense.paymentLineIds.filter(booked);

    if (paymentLineIds.length === 0) {
      return [];
    }

    const refundLineIds = expense.refundLineIds.filter(booked);

    return [
      {
        ...expense,
        paymentLineIds,
        refundLineIds,
        netMinor: -(sum(paymentLineIds) + sum(refundLineIds)),
      },
    ];
  });

  // A statement cannot cover days that have not come yet, and none is imported before its month.
  const statements =
    `${made.month}-01` > day
      ? []
      : made.statements.map((statement) => ({
          ...statement,
          coveredTo: statement.coveredTo < day ? statement.coveredTo : day,
        }));

  return {
    ...made,
    lines,
    expenses,
    investments: positionsOn(made, lines, day, previous),
    statements,
  };
}

/** The last `limit` months made, the least recently read dropped first. */
export function monthCache(limit: number, make: (month: string) => MadeUpMonth) {
  // A Map keeps its insertion order: the first key is the least recently read.
  const kept = new Map<string, MadeUpMonth>();

  return {
    get(month: string): MadeUpMonth {
      const made = kept.get(month) ?? make(month);

      kept.delete(month);
      kept.set(month, made);

      for (const oldest of kept.keys()) {
        if (kept.size <= limit) {
          break;
        }

        kept.delete(oldest);
      }

      return made;
    },

    months: (): ReadonlyArray<string> => [...kept.keys()],
  };
}

/** The made-up data, each user's reviews kept in memory: a restart forgets them. */
export const FixtureLedger = Layer.sync(Ledger, () => {
  const generated = monthCache(CACHED_MONTHS, (month) => madeUpMonth(month));
  const reviewedBy = new Map<string, Set<string>>();
  const generate = (month: string) => generated.get(month);

  const reviewedOf = (owner: string) => {
    const reviewed = reviewedBy.get(owner) ?? new Set<string>();

    reviewedBy.set(owner, reviewed);

    return reviewed;
  };

  const month = (owner: string, wanted: string) =>
    Effect.gen(function* () {
      const day = yield* today;
      const current = day.slice(0, 7);
      const earliest = addMonths(current, -MONTHS_FROM_TODAY);
      const latest = addMonths(current, MONTHS_FROM_TODAY);

      if (wanted < earliest || wanted > latest) {
        return yield* new MonthOutOfRange({ month: wanted, earliest, latest });
      }

      const asOf = monthAsOf(generate(wanted), day, generate(addMonths(wanted, -1)).investments);
      const reviewed = reviewedOf(owner);

      return {
        ...asOf,
        lines: asOf.lines.map((line) => ({
          ...line,
          reviewed: line.reviewed || reviewed.has(line.id),
        })),
      };
    });

  const markReviewed = (owner: string, lineId: string) =>
    Effect.gen(function* () {
      const wanted = monthOfLine(lineId);

      if (wanted === undefined) {
        return yield* new LineNotFound({ lineId });
      }

      const { lines } = yield* month(owner, wanted).pipe(
        Effect.catchTag("MonthOutOfRange", () => Effect.fail(new LineNotFound({ lineId }))),
      );

      const line = lines.find((candidate) => candidate.id === lineId);

      if (line === undefined) {
        return yield* new LineNotFound({ lineId });
      }

      if (line.reviewed) {
        return yield* new LineAlreadyReviewed({ lineId });
      }

      reviewedOf(owner).add(lineId);

      return { ...line, reviewed: true };
    });

  return { month, markReviewed };
});
