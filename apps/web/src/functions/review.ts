import {
  acceptProposal,
  correctLine as correctCoreLine,
  proposalKey,
  queuedLine,
  startingPoints,
} from "@gousset/core";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { LineId } from "@/lib/operations-search";
import { runCore } from "@/services";

import { CategoryId } from "./categories";
import { signedIn, slowedInDevelopment } from "./month";

/** The user's counts on the screens that work today, which the review leads to until it ships. */
export const getStartingPoints = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(startingPoints(context.owner)));

// The operations page's review mode (#35), on `@gousset/core`'s review queue, as the MCP door's
// `review` tool reads and changes it: a line to review with its proposal, accepted or corrected. A
// refusal comes back as a code the page translates; a failure of the server itself is thrown.

/**
 * Why a review was refused: the line is gone or reviewed meanwhile, its proposal changed since it
 * was shown, a held line is no longer held, the transfer or the refund proposed cannot be made any
 * more, no category was given for a line that needs one, or the category was refused.
 */
export type ReviewRefusalCode =
  | "LINE_NOT_FOUND"
  | "ALREADY_REVIEWED"
  | "PROPOSAL_CHANGED"
  | "NOT_HELD"
  | "CANNOT_PAIR"
  | "CANNOT_LINK"
  | "CATEGORY_REQUIRED"
  | "LINE_NOT_CLASSIFIABLE"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_KIND_MISMATCH"
  | "CATEGORY_ARCHIVED";

const refused = (code: ReviewRefusalCode) => Effect.succeed({ ok: false as const, code });

/** The refusals accepting and correcting share, by the error's tag. */
const SHARED = {
  LineNotFound: () => refused("LINE_NOT_FOUND"),
  LineAlreadyReviewed: () => refused("ALREADY_REVIEWED"),
  NotHeld: () => refused("NOT_HELD"),
  LineNotClassifiable: () => refused("LINE_NOT_CLASSIFIABLE"),
  CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
  CategoryKindMismatch: () => refused("CATEGORY_KIND_MISMATCH"),
  // The only refusal classifying meets: the category is archived.
  CategoryRefused: () => refused("CATEGORY_ARCHIVED"),
};

/** A proposal's key as the page was shown it: blank for one that names nothing. */
const Seen = Schema.String.check(Schema.isMaxLength(64));

/**
 * One line to review with what Gousset proposes for it now, and that proposal's key, which
 * accepting gives back. A line the user does not have, or no longer to review, comes back as a code.
 */
export const getQueuedLine = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      queuedLine(context.owner, data.lineId).pipe(
        Effect.map((queued) => ({
          ok: true as const,
          queued,
          key: proposalKey(queued.proposal),
        })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
          LineAlreadyReviewed: () => refused("ALREADY_REVIEWED"),
        }),
      ),
    ),
  );

/**
 * Does what the line's proposal says (a held repeat discarded, the transfer paired, the refund
 * linked, the category kept as the user's choice), the line's review then done. `seen` is the key
 * of the proposal the page showed: one changed since is refused, and nothing is done.
 */
export const acceptLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, seen: Seen })))
  .handler(({ data, context }) =>
    runCore(
      acceptProposal(context.owner, data.lineId, data.seen).pipe(
        Effect.map((queued) => ({ ok: true as const, kind: queued.proposal.kind })),
        Effect.catchTags({
          ...SHARED,
          ProposalChanged: () => refused("PROPOSAL_CHANGED"),
          TransferRefused: () => refused("CANNOT_PAIR"),
          LinkRefused: () => refused("CANNOT_LINK"),
        }),
      ),
    ),
  );

/**
 * Says what the line is instead of its proposal, as the user's choice: in `categoryId` (a
 * transfer's line is then no transfer); a held repeat is kept, and without a category stays to
 * review, its category Gousset's guess. Answers the category it went in, `null` for none.
 */
export const correctLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ lineId: LineId, categoryId: Schema.optional(CategoryId) }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      correctCoreLine(context.owner, data.lineId, { categoryId: data.categoryId }).pipe(
        Effect.map((corrected) => ({
          ok: true as const,
          kind: corrected.proposal.kind,
          category: corrected.category,
        })),
        Effect.catchTags({
          ...SHARED,
          CategoryRequired: () => refused("CATEGORY_REQUIRED"),
        }),
      ),
    ),
  );
