import { MAX_SEARCH_LINES, searchLines, showLine } from "@gousset/core";
import { AccountId } from "@gousset/core/account-values";
import { MAX_FILTER_TEXT } from "@gousset/ui/lib/operations";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { LineId } from "@/lib/operations-search";
import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/**
 * Why a search or a read of the lines was refused, as a code for the interface to translate. A
 * failure of the server itself is thrown, not answered with a code.
 */
export type LineRefusalCode =
  | "AMOUNT_INVALID"
  | "PERIOD_INVALID"
  | "CURSOR_INVALID"
  | "LINE_NOT_FOUND";

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

/** One line with all that is known of it; a line the user does not have comes back as a code. */
export const getLine = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      showLine(context.owner, data.lineId).pipe(
        Effect.map((line) => ({ ok: true as const, line })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
        }),
      ),
    ),
  );
