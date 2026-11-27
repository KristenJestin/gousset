import {
  MAX_SEARCH_LINES,
  MAX_SHARES,
  classifyLine as classifyCoreLine,
  fundExpense,
  lineExpensesOf,
  lineTransferOf,
  linkLine as linkCoreLine,
  pairLineWithAccount as pairCoreLineWithAccount,
  pairLines,
  refuseRefund as refuseCoreRefund,
  searchLines,
  showLine,
  splitLine as splitCoreLine,
  unfundExpense,
  unlinkLine as unlinkCoreLine,
  unpairLine as unpairCoreLine,
} from "@gousset/core";
import type { FundRefused, LinkRefused, SplitRefused, TransferRefused } from "@gousset/core";
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
  // One the user does not have gives no line (#37).
  subjectId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
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
 * One line with all that is known of it, its transfer (the other side it is paired with, or the
 * lines that may be its other side) and its expense (the expense of several lines it is part of,
 * its split, or the expenses it may refund). A line the user does not have comes back as a code.
 */
export const getLine = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      Effect.all([
        showLine(context.owner, data.lineId),
        lineTransferOf(context.owner, data.lineId),
        lineExpensesOf(context.owner, data.lineId),
      ]).pipe(
        Effect.map(([line, transfer, expenses]) => ({
          ok: true as const,
          line,
          transfer,
          expenses,
        })),
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
 * transfer to unpair. Paired with an account kept by its balance (#31): the account is gone, is
 * the line's own, is kept by its lines or is in another currency, or the line cannot be a side (of
 * no amount, held for review, made from a noted balance).
 */
export type TransferRefusalCode =
  | "LINE_NOT_FOUND"
  | "ALREADY_PAIRED"
  | "CANNOT_PAIR"
  | "NOT_A_TRANSFER"
  | "ACCOUNT_NOT_FOUND"
  | "SAME_ACCOUNT"
  | "ZERO_AMOUNT"
  | "NOT_COUNTED"
  | "MADE_FROM_BALANCE"
  | "ACCOUNT_KEPT_BY_LINES"
  | "OTHER_CURRENCY";

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

/** A refusal to pair a line with an account kept by its balance, by its reason. */
const ACCOUNT_PAIRING_CODES = {
  same_line: "CANNOT_PAIR",
  same_account: "SAME_ACCOUNT",
  same_sign: "CANNOT_PAIR",
  zero_amount: "ZERO_AMOUNT",
  not_counted: "NOT_COUNTED",
  made_from_balance: "MADE_FROM_BALANCE",
  already_paired: "ALREADY_PAIRED",
  no_candidate: "CANNOT_PAIR",
  several_candidates: "CANNOT_PAIR",
  account_kept_by_lines: "ACCOUNT_KEPT_BY_LINES",
  other_currency: "OTHER_CURRENCY",
} as const satisfies { readonly [Reason in TransferRefused["reason"]]: TransferRefusalCode };

/**
 * Pairs the line with an account kept by its balance (#31), which has no line of its own to pair
 * with: Gousset makes that account's side, the same day, of the opposite amount, and makes the
 * account's movements again. Refused with a code: a line or an account the user does not have, an
 * account that is the line's own, kept by its lines or in another currency, a line that is a side
 * already or cannot be one.
 */
export const pairLineWithAccount = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, accountId: AccountId })))
  .handler(({ data, context }) =>
    runCore(
      pairCoreLineWithAccount(context.owner, data.lineId, data.accountId).pipe(
        Effect.map((transfer) => ({ ok: true as const, transfer })),
        Effect.catchTags({
          LineNotFound: () => transferRefused("LINE_NOT_FOUND"),
          AccountNotFound: () => transferRefused("ACCOUNT_NOT_FOUND"),
          TransferRefused: (refusal) => transferRefused(ACCOUNT_PAIRING_CODES[refusal.reason]),
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

/**
 * Why linking, unlinking or splitting a line was refused, as a code for the interface to translate:
 * the line is gone; a side of a transfer, a split line, a line of another expense, a line in it
 * already, a refund above the net cost or another currency (`LINK_*`); shares that do not make the
 * line, in categories of its kind in use (`SPLIT_REFUSED`); a share's subject gone or archived, or
 * subjects on a share of money coming in (`SPLIT_SUBJECT_*`, #37); a line that is its expense
 * alone (`NOT_LINKED`); a line no refund is proposed for (`REFUND_NOT_PROPOSED`). A refusal about
 * one share names it (`index`, from 0).
 */
export type ExpenseRefusalCode =
  | "LINE_NOT_FOUND"
  | "LINK_TRANSFER"
  | "LINK_SPLIT"
  | "LINK_LINKED"
  | "LINK_ALREADY_LINKED"
  | "LINK_EXCEEDS"
  | "LINK_CURRENCY"
  | "LINK_OTHER"
  | "SPLIT_REFUSED"
  | "SPLIT_SUBJECT_UNKNOWN"
  | "SPLIT_SUBJECT_ARCHIVED"
  | "SPLIT_SUBJECT_INCOME"
  | "NOT_LINKED"
  | "REFUND_NOT_PROPOSED";

const expenseRefused = (code: ExpenseRefusalCode, index: number | null = null) =>
  Effect.succeed({ ok: false as const, code, index });

/** A refusal to split, by its reason: a share's subject has its own words (#37). */
const SPLIT_CODES = {
  not_counted: "SPLIT_REFUSED",
  zero_amount: "SPLIT_REFUSED",
  transfer: "SPLIT_REFUSED",
  linked: "SPLIT_REFUSED",
  funded: "SPLIT_REFUSED",
  count: "SPLIT_REFUSED",
  sum: "SPLIT_REFUSED",
  amount: "SPLIT_REFUSED",
  kind: "SPLIT_REFUSED",
  archived: "SPLIT_REFUSED",
  subject_unknown: "SPLIT_SUBJECT_UNKNOWN",
  subject_archived: "SPLIT_SUBJECT_ARCHIVED",
  subject_income: "SPLIT_SUBJECT_INCOME",
} as const satisfies { readonly [Reason in SplitRefused["reason"]]: ExpenseRefusalCode };

const LINK_CODES = {
  same_line: "LINK_OTHER",
  not_counted: "LINK_OTHER",
  zero_amount: "LINK_OTHER",
  made_from_balance: "LINK_OTHER",
  transfer: "LINK_TRANSFER",
  split: "LINK_SPLIT",
  linked: "LINK_LINKED",
  already_linked: "LINK_ALREADY_LINKED",
  currency: "LINK_CURRENCY",
  exceeds: "LINK_EXCEEDS",
} as const satisfies { readonly [Reason in LinkRefused["reason"]]: ExpenseRefusalCode };

/**
 * Makes the line a part of the expense of `intoId`, another line: a payment when its money goes
 * the expense's way, a refund otherwise. Answers the expense as it is now; refused with a code.
 */
export const linkLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, intoId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      linkCoreLine(context.owner, data.lineId, data.intoId).pipe(
        Effect.map((linked) => ({ ok: true as const, linked })),
        Effect.catchTags({
          LineNotFound: () => expenseRefused("LINE_NOT_FOUND"),
          LinkRefused: (refusal) => expenseRefused(LINK_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/** Takes the line out of its expense of several lines: it counts on its own again. */
export const unlinkLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      unlinkCoreLine(context.owner, data.lineId).pipe(
        Effect.map((expenses) => ({ ok: true as const, expenses })),
        Effect.catchTags({
          LineNotFound: () => expenseRefused("LINE_NOT_FOUND"),
          NotLinked: () => expenseRefused("NOT_LINKED"),
        }),
      ),
    ),
  );

/**
 * The user's answer that a line coming back is no refund (#208): an ordinary income, its entry as
 * it was, never proposed as a refund again (linking it by hand still can). Answers the line's
 * expenses as they are now; a line no refund is proposed for comes back as a code.
 */
export const refuseRefund = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      refuseCoreRefund(context.owner, data.lineId).pipe(
        Effect.map((expenses) => ({ ok: true as const, expenses })),
        Effect.catchTags({
          LineNotFound: () => expenseRefused("LINE_NOT_FOUND"),
          RefundNotProposed: () => expenseRefused("REFUND_NOT_PROPOSED"),
        }),
      ),
    ),
  );

/** A share's amount, typed in major units of the line's currency ("30", "12.50"). */
const ShareAmount = Schema.String.check(Schema.isMaxLength(32));

/** The most subjects a share names: a user has 200 at most. */
const MAX_SHARE_SUBJECTS = 200;

/**
 * Splits the line across categories, one share each, as the user's choice; the shares add up to the
 * line. One share puts it back in one category. Each share's `subjectIds` (#37), given, are exactly
 * its subjects; left out, it keeps the line's. Refused with a code, and the share it is about.
 */
export const splitLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        lineId: LineId,
        shares: Schema.Array(
          Schema.Struct({
            categoryId: CategoryId,
            amount: ShareAmount,
            subjectIds: Schema.optional(
              Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(
                Schema.isMaxLength(MAX_SHARE_SUBJECTS),
              ),
            ),
          }),
        ).check(Schema.isMaxLength(MAX_SHARES)),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      splitCoreLine(context.owner, data.lineId, data.shares).pipe(
        Effect.map((expenses) => ({ ok: true as const, expenses })),
        Effect.catchTags({
          LineNotFound: () => expenseRefused("LINE_NOT_FOUND"),
          SplitRefused: (refusal) =>
            expenseRefused(SPLIT_CODES[refusal.reason], refusal.index ?? null),
          CategoryNotFound: () => expenseRefused("SPLIT_REFUSED"),
        }),
      ),
    ),
  );

/**
 * Why funding an expense with a works council refund, or unfunding it, was refused (#29), as a code
 * for the interface to translate: the line is gone; the transfer is no refund from a benefit
 * account; the line chosen is part of no expense, or of a split one; the expense is in another
 * currency, happened after the refund, or costs less than it with its other refunds; the refund
 * funds another expense already; or it funds none any more.
 */
export type FundRefusalCode =
  | "LINE_NOT_FOUND"
  | "FUND_NOT_FROM_BENEFIT"
  | "FUND_NOT_AN_EXPENSE"
  | "FUND_SPLIT"
  | "FUND_CURRENCY"
  | "FUND_LATER"
  | "FUND_OVER_COST"
  | "FUND_ALREADY_FUNDING"
  | "NOT_FUNDING";

const fundRefused = (code: FundRefusalCode) => Effect.succeed({ ok: false as const, code });

const FUND_CODES = {
  not_a_transfer: "FUND_NOT_FROM_BENEFIT",
  not_from_benefit: "FUND_NOT_FROM_BENEFIT",
  not_an_expense: "FUND_NOT_AN_EXPENSE",
  split: "FUND_SPLIT",
  currency: "FUND_CURRENCY",
  later: "FUND_LATER",
  over_cost: "FUND_OVER_COST",
  already_funding: "FUND_ALREADY_FUNDING",
} as const satisfies { readonly [Reason in FundRefused["reason"]]: FundRefusalCode };

/**
 * Makes the transfer the line is a side of, a works council refund, fund the expense of
 * `expenseLineId`, one of its lines: the expense keeps its cost. Answers the expense as it is now;
 * refused with a code.
 */
export const fundLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId, expenseLineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      fundExpense(context.owner, data.lineId, data.expenseLineId).pipe(
        Effect.map((expense) => ({ ok: true as const, expense })),
        Effect.catchTags({
          LineNotFound: () => fundRefused("LINE_NOT_FOUND"),
          FundRefused: (refusal) => fundRefused(FUND_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/** The transfer the line is a side of funds no expense any more; it stays a transfer. */
export const unfundLine = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ lineId: LineId })))
  .handler(({ data, context }) =>
    runCore(
      unfundExpense(context.owner, data.lineId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          LineNotFound: () => fundRefused("LINE_NOT_FOUND"),
          NotFunding: () => fundRefused("NOT_FUNDING"),
        }),
      ),
    ),
  );
