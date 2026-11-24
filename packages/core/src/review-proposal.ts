import type { LineCategory } from "./category-store";
import type { RefundProposal } from "./expenses/expenses";
import type { NamedMerchant } from "./merchants/line-merchant";
import type { Money } from "./month";
import type { TransferSide } from "./transfers/transfers";

// What the review proposes for each line to review (#35), decided from what is known of it. The
// queue (`./review-queue`) reads those facts; the choice and its priority are here, pure.

/** The line a held one looks like, as its detail gives it. */
export type RepeatedLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly label: string;
  readonly amount: Money;
};

/**
 * What accepting a line to review does, by priority:
 * - `duplicate`: a line held as a near duplicate is discarded, as a repeat of `of` (null when the
 *   line it looked like is gone);
 * - `transfer`: a line whose transfer's other side the user chooses among several is paired with
 *   `candidate`, the first as a line's detail orders them (nearest first), `others` more remaining;
 * - `refund`: a line coming back, which may cancel expenses, is linked as a refund of `expense`, the
 *   likeliest, `others` more remaining;
 * - `category`: the line keeps the category Gousset put it in (its kind's fallback, its merchant's
 *   default or its top-up card's), as the user's choice; with its merchant when one is known.
 */
export type ReviewProposal =
  | { readonly kind: "duplicate"; readonly of: RepeatedLine | null }
  | { readonly kind: "transfer"; readonly candidate: TransferSide; readonly others: number }
  | { readonly kind: "refund"; readonly expense: RefundProposal; readonly others: number }
  | {
      readonly kind: "category";
      /** Null only for a line with no entry, which no category proposal can keep. */
      readonly category: LineCategory | null;
      readonly merchant: NamedMerchant | null;
    };

/** What a line to review's proposal is decided from. */
export type ProposalFacts = {
  /** Held as a near duplicate. */
  readonly held: boolean;
  readonly duplicateOf: RepeatedLine | null;
  /**
   * The lines that may be its transfer's other side, nearest first: only for a line waiting for
   * the user to choose among several; empty otherwise.
   */
  readonly candidates: ReadonlyArray<TransferSide>;
  /** The expenses it may cancel, the likeliest first; empty for none. */
  readonly refunds: ReadonlyArray<RefundProposal>;
  readonly amountMinor: number;
  readonly category: LineCategory | null;
  readonly merchant: NamedMerchant | null;
};

/** The proposal a line to review gets, by the priority `ReviewProposal` says. */
export function proposalOf(facts: ProposalFacts): ReviewProposal {
  if (facts.held) {
    return { kind: "duplicate", of: facts.duplicateOf };
  }

  const [candidate, ...otherCandidates] = facts.candidates;

  if (candidate !== undefined) {
    return { kind: "transfer", candidate, others: otherCandidates.length };
  }

  const [expense, ...otherExpenses] = facts.refunds;

  if (expense !== undefined && facts.amountMinor > 0) {
    return { kind: "refund", expense, others: otherExpenses.length };
  }

  return { kind: "category", category: facts.category, merchant: facts.merchant };
}

/** What a proposal names: the line or the category its key carries after its kind. */
function namedBy(proposal: ReviewProposal): string | null {
  switch (proposal.kind) {
    case "duplicate": {
      return proposal.of?.id ?? null;
    }

    case "transfer": {
      return proposal.candidate.id;
    }

    case "refund": {
      return proposal.expense.line.lineId;
    }

    case "category": {
      return proposal.category?.id ?? null;
    }
  }
}

/**
 * What a proposal does, as one key, its kind then what it names (`transfer:<line>`): the line a
 * duplicate repeats, the transfer's candidate, the line that paid the expense refunded, the category
 * kept; the kind alone when it names nothing. Accepting a line gives the key of the proposal the user
 * saw, so that a proposal changed meanwhile, even to another kind naming the same line, is never
 * accepted in its place.
 */
export function proposalKey(proposal: ReviewProposal): string {
  const named = namedBy(proposal);

  return named === null ? proposal.kind : `${proposal.kind}:${named}`;
}
