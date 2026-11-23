import {
  MAX_SEARCH_LINES,
  classifyLine as classifyCoreLine,
  lineTransferOf,
  pairLines,
  searchLines,
  showLine,
  unpairLine as unpairCoreLine,
} from "@gousset/core";
import { AccountId } from "@gousset/core/account-values";
import { MAX_FILTER_TEXT } from "@gousset/ui/lib/operations";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { LineId } from "@/lib/operations-search";
import { runCore } from "@/services";

import { CategoryId } from "./categories";
import { signedIn, slowedInDevelopment } from "./month";

/**
 * Why a search or a read of the lines was refused, as a code for the interface to translate. A
 * failure of the server itself is thrown, not answered with a code.
 */
export type LineRefusalCode =
  | "AMOUNT_INVALID"
  | "PERIOD_INVALID"
  | "CURSOR_INVALID"
  | "LINE_NOT_FOUND"
  | "LINE_NOT_CLASSIFIABLE"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_KIND_MISMATCH"
  | "CATEGORY_ARCHIVED";

const refused = (code: LineRefusalCode) => Effect.succeed({ ok: false as const, code });

const SEARCH_CODES = {
  amount: "AMOUNT_INVALID",
  period: "PERIOD_INVALID",
  cursor: "CURSOR_INVALID",
} as const;

/**
 * Room for any search a person types, and no more: the server never reads a page of text. The
 * filter fields stop the typing there, and the page's address is cut to it.
 */
const Words = Schema.String.check(Schema.isMaxLength(MAX_FILTER_TEXT));

/**
 * A search of the lines, as the operations page sends it (`LineSearch` in `@gousset/core`). The
 * days and amounts go to the core as typed: what it cannot read comes back as a code, shown under
 * its field, rather than as a failed call.
 */
export const LineSearchInput = Schema.Struct({
  text: Schema.optional(Words),
  accountId: Schema.optional(AccountId),
  from: Schema.optional(Words),
  to: Schema.optional(Words),
  amountMin: Schema.optional(Words),
  amountMax: Schema.optional(Words),
  toReview: Schema.optional(Schema.Boolean),
  after: Schema.optional(Words),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_SEARCH_LINES })),
  ),
});

export type LineSearchInput = typeof LineSearchInput.Type;

/**
 * Every line of the user's that matches, across accounts, newest first, a page at a time, with how
 * many match in all. An amount, a period or a cursor that cannot be read comes back as a code.
 */
export const getLines = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(LineSearchInput))
  .handler(({ data, context }) =>
    runCore(
      searchLines(context.owner, data).pipe(
        Effect.map((page) => ({ ok: true as const, page })),
        Effect.catchTags({
          LineSearchRefused: (refusal) => refused(SEARCH_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/**
 * One line with all that is known of it, and its transfer: the other side it is paired with, or the
 * lines that may be its other side. A line the user does not have comes back as a code.
 */
export const getLine = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      Effect.all([
        showLine(context.owner, data.lineId),
        lineTransferOf(context.owner, data.lineId),
      ]).pipe(
        Effect.map(([line, transfer]) => ({ ok: true as const, line, transfer })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
        }),
      ),
    ),
  );

/**
 * Puts a line in a category, as the user's choice: its one entry's category. Refused with a code:
 * a line the user does not have, a line with no single entry (held, discarded, of no amount, or
 * split), a category the user does not have, of the other kind, or archived.
 */
export const classifyLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, categoryId: CategoryId })))
  .handler(({ data, context }) =>
    runCore(
      classifyCoreLine(context.owner, data.lineId, { categoryId: data.categoryId }).pipe(
        Effect.map((category) => ({ ok: true as const, category })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
          LineNotClassifiable: () => refused("LINE_NOT_CLASSIFIABLE"),
          CategoryNotFound: () => refused("CATEGORY_NOT_FOUND"),
          CategoryKindMismatch: () => refused("CATEGORY_KIND_MISMATCH"),
          // The only refusal classifying meets: the category is archived.
          CategoryRefused: () => refused("CATEGORY_ARCHIVED"),
        }),
      ),
    ),
  );

/**
 * Why pairing or unpairing a line was refused, as a code for the interface to translate: the line
 * is gone, one of the two lines is a side of a transfer already or cannot be one, or the line is no
 * transfer to unpair.
 */
export type TransferRefusalCode =
  | "LINE_NOT_FOUND"
  | "ALREADY_PAIRED"
  | "CANNOT_PAIR"
  | "NOT_A_TRANSFER";

const transferRefused = (code: TransferRefusalCode) => Effect.succeed({ ok: false as const, code });

/**
 * Pairs the line with `otherId` as the two sides of a transfer, the user's own pairing. Refused
 * with a code: a line the user does not have, a line that is a side already, two lines that cannot
 * be the two sides of one transfer (the same account, the same sign, a held line).
 */
export const pairLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, otherId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      pairLines(context.owner, data.lineId, data.otherId).pipe(
        Effect.map((transfer) => ({ ok: true as const, transfer })),
        Effect.catchTags({
          LineNotFound: () => transferRefused("LINE_NOT_FOUND"),
          TransferRefused: (refusal) =>
            transferRefused(refusal.reason === "already_paired" ? "ALREADY_PAIRED" : "CANNOT_PAIR"),
        }),
      ),
    ),
  );

/**
 * Undoes the transfer the line is a side of: both lines are no transfer any more, and a side the
 * app had made, this line or the other, is deleted. Answers the other side as it was, and whether
 * this line itself was the made one, now gone; a line that is no transfer comes back as a code.
 */
export const unpairLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      unpairCoreLine(context.owner, data.lineId).pipe(
        Effect.map(({ other, madeSideDeleted }) => ({
          ok: true as const,
          other,
          lineDeleted: madeSideDeleted && !other.madeByApp,
        })),
        Effect.catchTags({
          LineNotFound: () => transferRefused("LINE_NOT_FOUND"),
          NotATransfer: () => transferRefused("NOT_A_TRANSFER"),
        }),
      ),
    ),
  );
