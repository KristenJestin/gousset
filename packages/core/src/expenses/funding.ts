import type { AccountKind } from "../account-values";
import { shiftDay } from "../transfers/pairing";
import type { EntryKind } from "./parts";

// Works council refunds (#29; docs/data-model.md, `transfer.funds_entry_id`): a transfer out of a
// benefit account to an account of another kind may fund an expense, all or part of it. The expense
// keeps its cost; the transfer is the restricted money made available. The rules alone, on values
// already read, so that funding, its refusals and the expenses a side is offered all decide alike.

/** How many days before a transfer the expenses it may fund happened, at most. */
export const FUND_DAYS = 90;

/** How many expenses a transfer's side is offered to fund, at most. */
export const FUND_CANDIDATES = 10;

/** A transfer, as funding reads it: its side out's account, day and amount; the in side's kind. */
export type FundingTransfer = {
  readonly outKind: AccountKind;
  readonly inKind: AccountKind;
  /** The side out's day: the expense must have happened by then. */
  readonly bookedOn: string;
  /** What it moved, positive, in its side out's currency. */
  readonly amountMinor: number;
  readonly currency: string;
  /** The expense it funds already; null when none. */
  readonly fundsEntryId: string | null;
};

/** An expense, as funding reads it. */
export type FundingTarget = {
  readonly id: string;
  readonly kind: EntryKind;
  readonly happenedOn: string;
  readonly currency: string;
  /** Its payments less its refunds: what it costs, which funding leaves as it is. */
  readonly netMinor: number;
  /** What the transfers funding it fund together, this transfer's own left out. */
  readonly fundedByOthersMinor: number;
};

/** Whether the transfer goes from a benefit account to an account of another kind. */
export const fundsFromBenefit = (transfer: FundingTransfer) =>
  transfer.outKind === "benefit" && transfer.inKind !== "benefit";

/** What is left of an expense's cost to fund once its fundings are counted. */
const unfunded = (target: FundingTarget) => target.netMinor - target.fundedByOthersMinor;

/** Why a transfer cannot fund an expense, and which of the two lines it is about. */
export type FundRefusal = {
  readonly reason:
    | "not_from_benefit"
    | "not_an_expense"
    | "split"
    | "currency"
    | "later"
    | "over_cost"
    | "already_funding";
  readonly about: "transfer" | "expense";
};

/**
 * Whether `transfer` may fund `target`, the one expense of the line named (`none` when that line
 * is part of none, `split` when it is split across several): `fund` to write it, `same` when it
 * funds that expense already (nothing to do), or why not. A funding never passes the expense's
 * cost, its other fundings counted, at the time it is made.
 */
export function fundDecision(
  transfer: FundingTransfer,
  target: FundingTarget | "none" | "split",
): "fund" | "same" | FundRefusal {
  if (!fundsFromBenefit(transfer)) {
    return { reason: "not_from_benefit", about: "transfer" };
  }

  if (target === "none" || (target !== "split" && target.kind !== "expense")) {
    return { reason: "not_an_expense", about: "expense" };
  }

  if (target === "split") {
    return { reason: "split", about: "expense" };
  }

  if (transfer.fundsEntryId === target.id) {
    return "same";
  }

  if (transfer.fundsEntryId !== null) {
    return { reason: "already_funding", about: "transfer" };
  }

  if (target.currency !== transfer.currency) {
    return { reason: "currency", about: "expense" };
  }

  if (target.happenedOn > transfer.bookedOn) {
    return { reason: "later", about: "expense" };
  }

  return transfer.amountMinor > unfunded(target)
    ? { reason: "over_cost", about: "expense" }
    : "fund";
}

/**
 * The expenses a transfer funding none is offered to fund, for the user to choose, never applied
 * unasked: expenses of its currency, happened on its day or up to `FUND_DAYS` before, whose cost less
 * their other fundings is at least its amount. The nearest day first; `FUND_CANDIDATES` at most.
 */
export function fundingCandidates<Target extends FundingTarget>(
  transfer: FundingTransfer,
  targets: ReadonlyArray<Target>,
): ReadonlyArray<Target> {
  if (!fundsFromBenefit(transfer) || transfer.fundsEntryId !== null) {
    return [];
  }

  const earliest = shiftDay(transfer.bookedOn, -FUND_DAYS);

  return targets
    .filter((target) => target.happenedOn >= earliest && fundDecision(transfer, target) === "fund")
    .toSorted((a, b) => b.happenedOn.localeCompare(a.happenedOn) || b.id.localeCompare(a.id))
    .slice(0, FUND_CANDIDATES);
}
