import { statementLine } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import { remakeBalanceLines } from "./balance-lines";
import { classifyLine } from "./categories";
import { CategoryStore } from "./category-store";
import type { EntryKind, LineCategory } from "./category-store";
import { takeCategoryTurn } from "./category-turn";
import { entriesForLines } from "./entries";
import {
  CategoryKindMismatch,
  CategoryNotFound,
  CategoryRefused,
  CategoryRequired,
  LineAlreadyReviewed,
  NotHeld,
  ProposalChanged,
} from "./errors";
import { lineExpensesOf, linkLine } from "./expenses/expenses";
import { LineStore } from "./line-store";
import type { FoundLine } from "./line-store";
import { findLines, lineToReview, rowOf, showLine } from "./lines";
import type { LineRow, LineSearch } from "./lines";
import { lineMerchant } from "./merchants/merchants";
import { proposalKey, proposalOf } from "./review-proposal";
import type { RepeatedLine, ReviewProposal } from "./review-proposal";
import { today } from "./today";
import { lineTransferOf, pairLines } from "./transfers/transfers";

// The lines to review, one at a time, each with what Gousset proposes (#35), for the review page and
// the MCP door alike. The queue is the operations page's filter "to review" (`./lines`, one
// definition): lines held as near duplicates, counted lines whose transfer's other side the user
// chooses among several, and counted lines whose entry Gousset still guessed (`classified_by =
// default`). A line a rule classified stays out: a rule is the user's own decision, applied. Each
// write goes through the function that already does it, with its locks.

/** What a page of the queue reads: a search of the lines, always of those to review. */
export type ReviewSearch = Omit<LineSearch, "toReview">;

/** A line to review and what accepting it does. */
export type QueuedLine = { readonly line: LineRow; readonly proposal: ReviewProposal };

/** A page of the queue, in the operations list's order and cursor. */
export type ReviewQueuePage = {
  /** Newest first: booked on, then id. */
  readonly lines: ReadonlyArray<QueuedLine>;
  /** Give it as `after` for the next page; null on the last one. */
  readonly next: string | null;
  /** How many lines are to review in all, whatever the page. */
  readonly total: number;
};

/** What the user says a line to review is instead of the proposal. */
export type Correction = {
  /** The category it goes in; required but for a held line, which is then kept as it is. */
  readonly categoryId?: string;
};

/** A line corrected: as it was in the queue, and the category it went in (null for none). */
export type CorrectedLine = QueuedLine & { readonly category: LineCategory | null };

/** The line a held one repeats, from its detail; null when that line is gone. */
const repeatedOf = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const store = yield* LineStore;
    const day = yield* today;
    const detail = yield* store.show(owner, lineId, day);
    const of = detail?.duplicateOf ?? null;

    const repeated: RepeatedLine | null =
      of === null
        ? null
        : {
            id: of.id,
            bookedOn: of.bookedOn,
            label: of.label,
            amount: { minor: of.amountMinor, currency: of.currency },
          };

    return repeated;
  });

/**
 * The proposal of a line to review, reading only what its priority needs: a held line's original,
 * else a waiting transfer's candidates, else a line coming back's refund proposals, else its merchant.
 */
const proposalFor = (owner: string, line: FoundLine, waitsForTransfer: boolean) =>
  Effect.gen(function* () {
    const known = {
      amountMinor: line.amountMinor,
      category: line.category,
      duplicateOf: null,
      candidates: [],
      refunds: [],
      merchant: null,
    };

    if (line.state === "held") {
      return proposalOf({ ...known, held: true, duplicateOf: yield* repeatedOf(owner, line.id) });
    }

    const candidates = waitsForTransfer ? (yield* lineTransferOf(owner, line.id)).candidates : [];

    const refunds =
      candidates.length === 0 && line.amountMinor > 0
        ? (yield* lineExpensesOf(owner, line.id)).proposals
        : [];

    const merchant =
      candidates.length === 0 && refunds.length === 0
        ? (yield* lineMerchant(owner, line.id)).merchant
        : null;

    return proposalOf({ ...known, held: false, candidates, refunds, merchant });
  });

/**
 * A page of the lines to review, newest first, each with its proposal, and how many there are in
 * all; the proposals are read for the page's lines only. A line gone meanwhile is left out. Fails
 * with `LineSearchRefused` for a period, an amount or a cursor that cannot be read.
 */
export const reviewQueue = (owner: string, search: ReviewSearch = {}) =>
  Effect.gen(function* () {
    const found = yield* findLines(owner, { ...search, toReview: true });

    const queued = yield* Effect.forEach(found.lines, (line) =>
      proposalFor(owner, line, found.toChoose.has(line.id)).pipe(
        Effect.map((proposal): ReadonlyArray<QueuedLine> => [
          { line: rowOf(line, true), proposal },
        ]),
        Effect.catchTag("LineNotFound", () => Effect.succeed([])),
      ),
    );

    const page: ReviewQueuePage = { lines: queued.flat(), next: found.next, total: found.total };

    return page;
  });

/**
 * One line to review with its proposal now. Fails with `LineNotFound` for no line of the user's,
 * `LineAlreadyReviewed` for a line no longer to review (reviewed elsewhere, by a rule, or never).
 */
export const queuedLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const found = yield* lineToReview(owner, lineId);

    if (found === undefined) {
      // Fails first with `LineNotFound` when the line is none of the user's at all.
      yield* showLine(owner, lineId);

      return yield* new LineAlreadyReviewed({ lineId });
    }

    const queued: QueuedLine = {
      line: rowOf(found.line, true),
      proposal: yield* proposalFor(owner, found.line, found.waitsForTransfer),
    };

    return queued;
  });

/** The line's review is done: the monthly review no longer lists it (`review_state`). */
const markReviewed = (owner: string, lineId: string, notATransfer: boolean) =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    yield* userData.transaction(owner, (transaction) =>
      transaction
        .update(statementLine)
        .set(
          notATransfer ? { reviewState: "done", transferRefused: true } : { reviewState: "done" },
        )
        .where(eq(statementLine.id, lineId)),
    );
  });

/**
 * Throws away a line held as a near duplicate (`state = discarded`): it is kept only so that the
 * next import of the same file does not bring it back. Fails with `LineNotFound`, or `NotHeld` for
 * a line that is not held.
 */
export const discardHeldLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const detail = yield* showLine(owner, lineId);

    const discarded = yield* userData.transaction(owner, (transaction) =>
      transaction
        .update(statementLine)
        .set({ state: "discarded" })
        .where(and(eq(statementLine.id, detail.id), eq(statementLine.state, "held")))
        .returning({ id: statementLine.id }),
    );

    if (discarded.length === 0) {
      return yield* new NotHeld({ lineId });
    }
  });

/**
 * Counts a line held as a near duplicate, as undoing an import counts the lines it gives back: it
 * repeats nothing any more, gets its entry (in its merchant's default category when it has one, else
 * its kind's fallback, still classified by default), and the movements of the accounts kept by their
 * balance are made again; in one transaction, the user's turn among the changes of the categories
 * taken first. The line as it is now. Fails with `LineNotFound`, or `NotHeld` for a line not held.
 */
export const keepHeldLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const detail = yield* showLine(owner, lineId);

    const kept = yield* userData.transaction(owner, async (transaction) => {
      await takeCategoryTurn(transaction, owner);

      const counted = await transaction
        .update(statementLine)
        .set({ state: "counted", duplicateOfLineId: null })
        .where(and(eq(statementLine.id, detail.id), eq(statementLine.state, "held")))
        .returning({ id: statementLine.id });

      if (counted.length === 0) {
        return false;
      }

      await entriesForLines(transaction, owner, [detail.id]);
      await remakeBalanceLines(transaction, owner);

      return true;
    });

    if (!kept) {
      return yield* new NotHeld({ lineId });
    }

    return yield* showLine(owner, lineId);
  });

/**
 * Does what a line to review's proposal says, through the function that does it, with its locks: a
 * held line discarded; a transfer paired with its candidate (both lines then reviewed); a line
 * linked as a refund of the expense proposed; a line kept in its category as the user's choice
 * (`classified_by = user`). The line leaves the queue, `review_state = done`. `seen` is the key of
 * the proposal the user saw (`proposalKey`): a proposal changed since fails with `ProposalChanged`,
 * and nothing is done; a category proposal naming no category has none to keep, and fails with
 * `CategoryRequired`: the line is corrected instead. Fails with `LineNotFound`,
 * `LineAlreadyReviewed`, and what each function it calls refuses (`TransferRefused`, `LinkRefused`,
 * `LineNotClassifiable`, `CategoryRefused`…).
 */
export const acceptProposal = (owner: string, lineId: string, seen: string) =>
  Effect.gen(function* () {
    const queued = yield* queuedLine(owner, lineId);
    const { proposal } = queued;

    if (proposalKey(proposal) !== seen) {
      return yield* new ProposalChanged({ lineId });
    }

    switch (proposal.kind) {
      case "duplicate": {
        yield* discardHeldLine(owner, lineId);
        break;
      }

      case "transfer": {
        yield* pairLines(owner, lineId, proposal.candidate.id);
        break;
      }

      case "refund": {
        yield* linkLine(owner, lineId, proposal.expense.line.lineId);
        yield* markReviewed(owner, lineId, false);
        break;
      }

      case "category": {
        if (proposal.category === null) {
          return yield* new CategoryRequired({ lineId });
        }

        yield* classifyLine(owner, lineId, { categoryId: proposal.category.id });
        yield* markReviewed(owner, lineId, false);
        break;
      }
    }

    return queued;
  });

/**
 * Fails as `classifyLine` would put a line of `amountMinor` in `categoryId`: no such category, not
 * of the line's kind (by its sign), or archived. Read before a held line is kept, so that a category
 * refused leaves it held, still to discard; a category archived between the two is still refused
 * by `classifyLine`, the line then kept and to review.
 */
const choosable = (owner: string, lineId: string, amountMinor: number, categoryId: string) =>
  Effect.gen(function* () {
    const store = yield* CategoryStore;
    const category = (yield* store.list(owner)).find((each) => each.id === categoryId);
    const lineKind: EntryKind = amountMinor < 0 ? "expense" : "income";

    if (category === undefined) {
      return yield* new CategoryNotFound({ categoryId });
    }

    if (category.kind !== lineKind) {
      return yield* new CategoryKindMismatch({ lineId, lineKind, categoryKind: category.kind });
    }

    if (category.archivedAt !== null) {
      return yield* new CategoryRefused({ reason: "archived" });
    }
  });

/**
 * Says what a line to review is instead of its proposal, as the user's choice: a held line is kept
 * (counted, then put in `categoryId` when given: without one it stays to review, its category now
 * Gousset's guess); a transfer's line is no transfer (`transfer_refused`, which the automatic pairing
 * leaves alone) and goes in `categoryId`; any other goes in `categoryId`. The line's review is then
 * done. Fails with `CategoryRequired` without a category but for a held line, `LineNotFound`,
 * `LineAlreadyReviewed`, and what `classifyLine` refuses: for a held line, before it is kept.
 */
export const correctLine = (owner: string, lineId: string, correction: Correction) =>
  Effect.gen(function* () {
    const queued = yield* queuedLine(owner, lineId);
    const { proposal } = queued;
    const { categoryId } = correction;

    if (categoryId === undefined && proposal.kind !== "duplicate") {
      return yield* new CategoryRequired({ lineId });
    }

    if (proposal.kind === "duplicate") {
      if (categoryId !== undefined) {
        yield* choosable(owner, lineId, queued.line.amount.minor, categoryId);
      }

      yield* keepHeldLine(owner, lineId);
    }

    if (categoryId === undefined) {
      const kept: CorrectedLine = { ...queued, category: null };

      return kept;
    }

    const category = yield* classifyLine(owner, lineId, { categoryId });

    yield* markReviewed(owner, lineId, proposal.kind === "transfer");

    const corrected: CorrectedLine = { ...queued, category };

    return corrected;
  });
