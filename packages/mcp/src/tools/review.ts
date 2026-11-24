import {
  acceptProposal,
  correctLine,
  lineMerchant,
  proposalKey,
  reviewQueue,
  ruleWords,
  showLine,
} from "@gousset/core";
import type {
  CategoryStore,
  EntryKind,
  Expenses,
  LineRow,
  LineStore,
  Merchants,
  QueuedLine,
  ReviewProposal,
  ReviewQueuePage,
  Transfers,
} from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { MOVEMENT, amount, named } from "./accounts";
import { namedCategory, pathText } from "./categories";
import { proposedRule } from "./rules";

/** The lines `list` gives when none are asked for, and the most. */
const DEFAULT_LINES = 20;
const MAX_LINES = 50;

const ReviewInput = Schema.Struct({
  action: Schema.Literals(["list", "accept", "correct"]).annotate({
    description:
      "list: the lines to review with their proposals. accept: does a line's proposal (writes). correct: puts a line in category instead (writes).",
  }),
  line: Schema.optional(
    Schema.String.annotate({
      description: "accept, correct: the line's handle, as list gives it.",
    }),
  ),
  proposal: Schema.optional(
    Schema.String.annotate({
      description: "accept: the proposal's handle, as list gives it with the line.",
    }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description: 'correct: the category, named as for lines classify ("Parent > Child").',
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_LINES })).annotate({
      description: `list: 1 to ${MAX_LINES} lines; ${DEFAULT_LINES} if left out.`,
    }),
  ),
  after: Schema.optional(
    Schema.String.annotate({ description: "list: exactly as the result's next call gives it." }),
  ),
});

type ReviewInput = typeof ReviewInput.Type;

const DESCRIPTION = `The lines waiting for the user's review, one at a time, each with what Gousset proposes: the lines \`lines\` gives with to_review (near duplicates held, transfers with several possible other sides, lines still classified by default; never a line a rule classified, which is the user's decision). \`list\` gives a page, newest first: each line, its proposal in words, its handle and the proposal's, how many in all, and the next call.

\`accept\` does the proposal: discards a held repeat, pairs the transfer with its first candidate, links the line as a refund of the expense proposed, or keeps its category as the user's choice. Refused when the line was reviewed meanwhile or its proposal changed since listed: list again. \`correct\` puts the line in \`category\` instead (named as \`lines\` classify takes it): a held line is kept and counted (category optional), a transfer's line becomes no transfer. Another candidate, another expense or a split: \`lines\`. accept and correct need the write scope.

Examples: {"action":"list"} · {"action":"accept","line":"<handle>","proposal":"<its proposal's handle>"} · {"action":"correct","line":"<handle>","category":"Groceries > Bakery"}`;

const call = (input: typeof ReviewInput.Encoded) => `review ${JSON.stringify(input)}`;

const LIST = call({ action: "list" });

const quoted = (label: string) => (label === "" ? "(no label)" : `"${label}"`);

const labelOf = (line: LineRow) => (line.fromBalance ? `(${MOVEMENT})` : quoted(line.label));

const others = (count: number, what: string) =>
  count === 0 ? "" : ` (${count} other ${what}${count === 1 ? "" : "s"}: lines show)`;

/** What accepting does, in words. */
function proposalText(proposal: ReviewProposal): string {
  switch (proposal.kind) {
    case "duplicate": {
      const { of } = proposal;

      return of === null
        ? "discard it, a near duplicate held"
        : `discard it, it repeats the line of ${of.bookedOn}, ${amount(of.amount)}, ${quoted(of.label)}`;
    }

    case "transfer": {
      const side = proposal.candidate;

      return `pair it as a transfer with the line of ${side.bookedOn}, ${named(side.account)}: ${amount(side.amount)}, ${quoted(side.label)}${others(proposal.others, "candidate")}`;
    }

    case "refund": {
      const { line, category, net } = proposal.expense;

      return `link it as a refund of the expense in ${pathText(category)} costing ${amount(net)}, paid ${line.bookedOn}, ${named(line.account)}, ${quoted(line.label)}${others(proposal.others, "expense")}`;
    }

    case "category": {
      const merchant = proposal.merchant === null ? "" : ` (merchant: ${proposal.merchant.name})`;

      return proposal.category === null
        ? `classify it${merchant}`
        : `keep it in ${pathText(proposal.category)}${merchant}`;
    }
  }
}

const lineText = ({ line }: QueuedLine) =>
  `${line.bookedOn}, ${named(line.account)}: ${amount(line.amount)}, ${labelOf(line)}`;

const queuedText = (queued: QueuedLine) =>
  `- ${lineText(queued)}: ${proposalText(queued.proposal)}; line: ${queued.line.id}; proposal: ${proposalKey(queued.proposal)}`;

function listText(page: ReviewQueuePage, input: ReviewInput): string {
  const header = `${page.total} line(s) to review.`;

  if (page.lines.length === 0) {
    return page.total === 0
      ? `${header} Nothing waits for the user.`
      : `${header}\n\nNo line on this page.`;
  }

  const next =
    page.next === null
      ? []
      : [
          `More remain. Read them with: ${call({ action: "list", limit: input.limit, after: page.next })}`,
        ];

  return [
    header,
    [
      `These ${page.lines.length}, newest first (booked on, account: amount, label: the proposal; the handles):`,
      ...page.lines.map(queuedText),
      ...next,
    ].join("\n"),
    `Accept one with ${call({ action: "accept", line: "<line>", proposal: "<proposal>" })}, or say what it is: ${call({ action: "correct", line: "<line>", category: "<a category>" })}.`,
  ].join("\n\n");
}

/** What accepting did, in words. */
function acceptedText(queued: QueuedLine): string {
  const done = `The line of ${lineText(queued)}`;

  switch (queued.proposal.kind) {
    case "duplicate": {
      return `${done} is discarded: it counts nowhere, and no later import that reads it again brings it back.`;
    }

    case "transfer": {
      return `${done} is paired as a transfer: never counted as spending.`;
    }

    case "refund": {
      return `${done} is linked as a refund of that expense, which now costs less.`;
    }

    case "category": {
      return `${done} stays in its category, as the user's choice: no rule changes it unasked.`;
    }
  }
}

const refused = (message: string, example: string = LIST) =>
  Effect.fail(new ToolRefusal({ message, example }));

const handleOf = (input: ReviewInput) => input.line?.trim() ?? "";

/** The refusals both writes of the review share, by the error's tag. */
const sharedRefusals = (line: string) => ({
  LineNotFound: () =>
    refused(
      `No line of the user's has the handle "${line.slice(0, 80)}". Handles come from list: use the handle its result gives.`,
    ),
  LineAlreadyReviewed: () =>
    refused(
      "This line is no longer to review: reviewed meanwhile (by the user, a rule or a pairing). List the lines to review again.",
    ),
  NotHeld: () =>
    refused("This line is no longer held as a near duplicate: list the lines to review again."),
  LineNotClassifiable: () =>
    refused(
      "This line has no category of its own now (held, a side of a transfer, or split): show it, then classify it with lines.",
      `lines ${JSON.stringify({ action: "show", line })}`,
    ),
  CategoryKindMismatch: (mismatch: { readonly lineKind: EntryKind }) =>
    refused(
      `This line is ${mismatch.lineKind === "expense" ? "an expense (money out)" : "an income (money in)"}: choose an ${mismatch.lineKind} category, as categories list gives them.`,
      `categories ${JSON.stringify({ action: "list", kind: mismatch.lineKind })}`,
    ),
  CategoryRefused: () =>
    refused(
      "That category is archived: it can no longer be chosen. Choose a category in use, or restore it with categories.",
      `categories ${JSON.stringify({ action: "list" })}`,
    ),
  CategoryNotFound: () =>
    refused(
      "The category is gone: list the categories again.",
      `categories ${JSON.stringify({ action: "list" })}`,
    ),
  QueryFailed: Effect.die,
});

/** What only accepting refuses: a proposal changed, or no longer doable as it was. */
const acceptRefusals = (line: string) => ({
  ...sharedRefusals(line),
  ProposalChanged: () =>
    refused(
      "This line's proposal changed since it was listed (its candidates, refunds or category): nothing was done. List again, and accept the proposal it gives now.",
    ),
  TransferRefused: () =>
    refused(
      "The transfer cannot be paired as proposed any more: show the line to see its candidates now, and pair one with lines.",
      `lines ${JSON.stringify({ action: "show", line })}`,
    ),
  LinkRefused: () =>
    refused(
      "The line cannot be linked to that expense any more: show it to see its proposals now, and link one with lines.",
      `lines ${JSON.stringify({ action: "show", line })}`,
    ),
  CategoryRequired: () =>
    refused(
      "This line is in no category: there is no category to keep. Say which it goes in with correct, the category named as lines classify takes it.",
      call({ action: "correct", line, category: "Groceries > Bakery" }),
    ),
});

function acceptRun(input: ReviewInput, owner: string) {
  const line = handleOf(input);

  if (line === "") {
    return refused("accept needs line and proposal, the handles list gives each line to review.");
  }

  return acceptProposal(owner, line, input.proposal?.trim() ?? "").pipe(
    Effect.map(acceptedText),
    Effect.catchTags(acceptRefusals(line)),
  );
}

function correctRun(input: ReviewInput, owner: string) {
  const line = handleOf(input);
  const name = input.category?.trim() ?? "";

  if (line === "") {
    return refused("correct needs line, the handle list gives a line to review, and category.");
  }

  return Effect.gen(function* () {
    const detail = yield* showLine(owner, line);
    const kind: EntryKind = detail.amount.minor < 0 ? "expense" : "income";

    const categoryId =
      name === ""
        ? undefined
        : (yield* namedCategory(owner, name, kind, (other) =>
            call({ action: "correct", line, category: other }),
          )).id;

    const corrected = yield* correctLine(owner, detail.id, { categoryId });
    const done = `The line of ${lineText(corrected)}`;

    if (corrected.category === null) {
      return `${done} is kept: it counts now. Its category is still to review: ${LIST}`;
    }

    const notTransfer =
      corrected.proposal.kind === "transfer"
        ? " It is no transfer: the automatic pairing leaves it alone."
        : "";

    const paid = yield* lineMerchant(owner, detail.id);

    const rule = proposedRule(
      ruleWords(detail.label, detail.counterpartyName, paid.intermediary !== null),
      { category: pathText(corrected.category) },
    );

    const text = `${done} is now in ${pathText(corrected.category)}, as the user's choice: no rule changes it unasked.${notTransfer}`;

    return rule === undefined ? text : `${text}\n${rule}`;
  }).pipe(
    Effect.catchTags({
      ...sharedRefusals(line),
      CategoryRequired: () =>
        refused(
          "correct needs category for this line: the category it goes in, named as lines classify takes it. Only a held line is kept without one.",
          `categories ${JSON.stringify({ action: "list" })}`,
        ),
    }),
  );
}

/**
 * The review family (docs/mcp.md, "Tools"; #35): the lines to review, each with Gousset's proposal,
 * accepted or corrected with the write scope. Pairing another candidate, linking another expense
 * and splitting stay `lines`'.
 */
export const reviewTool = defineTool<
  ReviewInput,
  typeof ReviewInput.Encoded,
  LineStore | CategoryStore | Transfers | Expenses | Merchants | UserData
>({
  name: "review",
  title: "Review",
  description: DESCRIPTION,
  // A repeat finds the line reviewed already, and is refused: nothing more changes.
  idempotent: true,
  input: ReviewInput,
  example: { action: "list" },
  access: { list: "read", accept: "write", correct: "write" },
  run: (input, caller) => {
    switch (input.action) {
      case "list": {
        return reviewQueue(caller.userId, {
          after: input.after,
          limit: input.limit ?? DEFAULT_LINES,
        }).pipe(
          Effect.map((page) => listText(page, input)),
          Effect.catchTags({
            LineSearchRefused: () =>
              refused(
                "after is a handle only a previous list's next call gives: copy it exactly, or leave it out to start from the newest line.",
              ),
            QueryFailed: Effect.die,
          }),
        );
      }

      case "accept": {
        return acceptRun(input, caller.userId);
      }

      case "correct": {
        return correctRun(input, caller.userId);
      }
    }
  },
});
