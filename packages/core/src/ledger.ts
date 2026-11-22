import { madeUpMonth, monthParts } from "@gousset/fixture";
import type { Line, MadeUpMonth } from "@gousset/fixture";
import { Context, Effect, Layer } from "effect";

import { LineAlreadyReviewed, LineNotFound } from "./errors";
import { today } from "./today";

/**
 * Where a user's money is read and changed. v0.1 has no tables of its own yet: `FixtureLedger`
 * serves the shared made-up data, the same for every user, and keeps each user's reviews in the
 * process's memory. The database's ledger replaces that layer once the data model exists; the read
 * functions (`./month`) stay as they are.
 */
export class Ledger extends Context.Service<
  Ledger,
  {
    /** The user's month, as it stands today: nothing after today, reviews applied. */
    readonly month: (owner: string, month: string) => Effect.Effect<MadeUpMonth>;
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

/** The made-up data, each user's reviews kept in memory: a restart forgets them. */
export const FixtureLedger = Layer.sync(Ledger, () => {
  const generated = new Map<string, MadeUpMonth>();
  const reviewedBy = new Map<string, Set<string>>();

  const generate = (month: string) => {
    const known = generated.get(month);

    if (known !== undefined) {
      return known;
    }

    const made = madeUpMonth(month);

    generated.set(month, made);

    return made;
  };

  const reviewedOf = (owner: string) => {
    const reviewed = reviewedBy.get(owner) ?? new Set<string>();

    reviewedBy.set(owner, reviewed);

    return reviewed;
  };

  const month = (owner: string, wanted: string) =>
    Effect.map(today, (day): MadeUpMonth => {
      const made = generate(wanted);
      const reviewed = reviewedOf(owner);

      return {
        ...made,
        lines: made.lines.flatMap((line) =>
          line.bookedOn > day
            ? []
            : [{ ...line, reviewed: line.reviewed || reviewed.has(line.id) }],
        ),
        expenses: made.expenses.filter((expense) => expense.bookedOn <= day),
      };
    });

  const markReviewed = (owner: string, lineId: string) =>
    Effect.gen(function* () {
      const wanted = monthOfLine(lineId);

      if (wanted === undefined) {
        return yield* new LineNotFound({ lineId });
      }

      const { lines } = yield* month(owner, wanted);
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
