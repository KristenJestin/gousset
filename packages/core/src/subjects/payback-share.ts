import { subtreeOf } from "./counting";
import type { SubjectNode } from "./counting";

// A subject paid back by someone else (#217; docs/data-model.md, v0.5, "Paid back"): the pure rule
// of what each of its expenses is still the user's cost, which the month, the benchmarks and the
// categories' averages all count by, and where the subject stands. Every euro counts once: until
// something comes back an expense counts in full; a payback covers the subject as a whole, so it is
// spread over its expenses by their cost, in the month each happened, as a refund (#27) lowers its
// own expense's cost there. What comes back beyond the cost is no income: it lowers no expense
// below nothing, and is only the subject's difference, on its page. That rule is `paidBackPart`.

/** Where a paid-back subject stands. */
export type PaybackState = "paid_back" | "partly" | "asked" | "to_ask";

/** A subject with the option, in one currency: what it cost all time, and what came back. */
export type PaidBackSubject = {
  readonly subjectId: string;
  readonly currency: string;
  /** Its expenses' net cost, by the counting rule (`./counting`), all time up to today. */
  readonly spentMinor: number;
  /** The sum of its payback lines. */
  readonly paidBackMinor: number;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

/**
 * How much of what was spent the payback covers: what came back, never more than what was spent.
 * The one place that says what comes back beyond the cost does.
 */
const paidBackPart = (spentMinor: number, paidBackMinor: number) =>
  Math.max(0, Math.min(paidBackMinor, spentMinor));

/**
 * What of an expense's net cost `netMinor` is left to the user, its subject having cost
 * `spentMinor` and been paid back `paidBackMinor`: net × (spent − min(paid back, spent)) / spent,
 * rounded to a minor unit, half away from zero, computed in `bigint`. The net itself when nothing
 * was spent.
 */
export function shareLeft(netMinor: number, spentMinor: number, paidBackMinor: number): number {
  if (spentMinor <= 0) {
    return netMinor;
  }

  const spent = BigInt(spentMinor);
  const product = BigInt(netMinor) * (spent - BigInt(paidBackPart(spentMinor, paidBackMinor)));
  const quotient = product / spent;
  const rest = product % spent;
  const away = TWO * (rest < ZERO ? -rest : rest) >= spent;

  return Number(away ? quotient + (product < ZERO ? -ONE : ONE) : quotient);
}

/**
 * What of each expense is left to the user, by `paidBack` (the subjects with the option and their
 * figures, per currency): an expense attached to such a subject or to one of its descendants
 * (`subjectsOf`, by entry) counts at that subject's share; on several, at the smallest share left
 * (the larger paid back), never both. Any other counts in full.
 */
export function leftToUserOf(
  nodes: ReadonlyArray<SubjectNode>,
  paidBack: ReadonlyArray<PaidBackSubject>,
  subjectsOf: ReadonlyMap<string, ReadonlyArray<string>>,
): (entryId: string, currency: string, netMinor: number) => number {
  if (paidBack.length === 0) {
    return (_entryId, _currency, netMinor) => netMinor;
  }

  const subtrees = new Map(
    [...new Set(paidBack.map((each) => each.subjectId))].map((id) => [id, subtreeOf(nodes, id)]),
  );

  return (entryId, currency, netMinor) => {
    const own = subjectsOf.get(entryId) ?? [];

    return paidBack.reduce((left, each) => {
      const subtree = subtrees.get(each.subjectId);

      if (each.currency !== currency || !own.some((id) => subtree?.has(id) === true)) {
        return left;
      }

      return Math.min(left, shareLeft(netMinor, each.spentMinor, each.paidBackMinor));
    }, netMinor);
  };
}

/**
 * Where a paid-back subject stands: `paid_back` when settled by hand, or when something was spent
 * and what came back reaches it; `partly` when something came back, less than spent; `asked` when
 * nothing came back and the user asked; `to_ask` otherwise.
 */
export function paybackStateOf(figures: {
  readonly spentMinor: number;
  readonly paidBackMinor: number;
  readonly askedOn: string | null;
  readonly settledOn: string | null;
}): PaybackState {
  const { spentMinor, paidBackMinor } = figures;

  if (figures.settledOn !== null || (spentMinor > 0 && paidBackMinor >= spentMinor)) {
    return "paid_back";
  }

  if (paidBackMinor > 0 && paidBackMinor < spentMinor) {
    return "partly";
  }

  if (paidBackMinor === 0 && figures.askedOn !== null) {
    return "asked";
  }

  return "to_ask";
}
