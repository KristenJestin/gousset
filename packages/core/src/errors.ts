import { Schema } from "effect";

/** No line of the user's has this id. */
export class LineNotFound extends Schema.TaggedError<LineNotFound>()("LineNotFound", {
  lineId: Schema.String,
}) {}

/**
 * A search of the lines cannot be read: an amount that is no decimal or a minimum above the maximum
 * (`amount`), a day that is no `YYYY-MM-DD` or a period that ends before it starts (`period`), a
 * cursor no page gave (`cursor`).
 */
export class LineSearchRefused extends Schema.TaggedError<LineSearchRefused>()(
  "LineSearchRefused",
  { reason: Schema.Literals(["amount", "period", "cursor"]) },
) {}

/**
 * Two lines cannot be paired as a transfer (#26): the same line twice (`same_line`), two lines of one
 * account (`same_account`), two lines both out or both in (`same_sign`), a line of nothing
 * (`zero_amount`), a line held for review or thrown away (`not_counted`), a line made from a noted
 * balance, which stands for a month's movement (`made_from_balance`), a line that is a side of a
 * transfer already (`already_paired`, `lineId` naming it); with no other side named, a line with no
 * candidate (`no_candidate`) or with several (`several_candidates`), for the user to choose. Paired
 * with an account kept by its balance (#31), whose side the app makes: an account kept by its lines
 * (`account_kept_by_lines`, which shows its own side), or of another currency than the line's
 * (`other_currency`).
 */
export class TransferRefused extends Schema.TaggedError<TransferRefused>()("TransferRefused", {
  reason: Schema.Literals([
    "same_line",
    "same_account",
    "same_sign",
    "zero_amount",
    "not_counted",
    "made_from_balance",
    "already_paired",
    "no_candidate",
    "several_candidates",
    "account_kept_by_lines",
    "other_currency",
  ]),
  lineId: Schema.String,
}) {}

/** The line is no side of a transfer: there is nothing to unpair. */
export class NotATransfer extends Schema.TaggedError<NotATransfer>()("NotATransfer", {
  lineId: Schema.String,
}) {}

/**
 * A line cannot join another line's expense as a payment or a refund (#27): the same line twice
 * (`same_line`), a line held for review or thrown away (`not_counted`), a line of nothing
 * (`zero_amount`), a line made from a noted balance (`made_from_balance`), a side of a transfer,
 * never an expense (`transfer`), a line split across several categories (`split`), a line that is
 * part of an expense with other lines already, to unlink first (`linked`), a line already in that
 * expense (`already_linked`), a line of another currency than the expense's (`currency`), a refund
 * bigger than what the expense still costs (`exceeds`). `lineId` names the line refused.
 */
export class LinkRefused extends Schema.TaggedError<LinkRefused>()("LinkRefused", {
  reason: Schema.Literals([
    "same_line",
    "not_counted",
    "zero_amount",
    "made_from_balance",
    "transfer",
    "split",
    "linked",
    "already_linked",
    "currency",
    "exceeds",
  ]),
  lineId: Schema.String,
}) {}

/**
 * A transfer cannot fund that expense (#29): its line is no side of a transfer (`not_a_transfer`), or
 * of a transfer that does not go from a benefit account to an account of another kind
 * (`not_from_benefit`); the expense's line is part of no expense (held, of no amount, a side of a
 * transfer, an income: `not_an_expense`), or is split across several (`split`); the expense is in
 * another currency than the transfer's side out (`currency`), happened after it was booked
 * (`later`), or costs less than the transfer and its other fundings together (`over_cost`); the
 * transfer funds another expense already, to unfund first (`already_funding`). `lineId` names the
 * line refused.
 */
export class FundRefused extends Schema.TaggedError<FundRefused>()("FundRefused", {
  reason: Schema.Literals([
    "not_a_transfer",
    "not_from_benefit",
    "not_an_expense",
    "split",
    "currency",
    "later",
    "over_cost",
    "already_funding",
  ]),
  lineId: Schema.String,
}) {}

/** The line is no side of a transfer that funds an expense: there is nothing to unfund. */
export class NotFunding extends Schema.TaggedError<NotFunding>()("NotFunding", {
  lineId: Schema.String,
}) {}

/** The line is the only line of its expense: there is nothing to unlink it from. */
export class NotLinked extends Schema.TaggedError<NotLinked>()("NotLinked", {
  lineId: Schema.String,
}) {}

/**
 * A line cannot be split across these categories (#27): a line held or thrown away
 * (`not_counted`), of nothing (`zero_amount`), a side of a transfer (`transfer`), a line that is
 * part of an expense with other lines (`linked`), the line of an expense a transfer funds, to unfund
 * first (`funded`, #29), no share or more than `MAX_SHARES` (`count`),
 * shares that do not add up to the line (`sum`); the share at `index` has no positive amount of the
 * line's currency (`amount`), a category of the other kind (`kind`) or an archived one (`archived`).
 */
export class SplitRefused extends Schema.TaggedError<SplitRefused>()("SplitRefused", {
  reason: Schema.Literals([
    "not_counted",
    "zero_amount",
    "transfer",
    "linked",
    "funded",
    "count",
    "sum",
    "amount",
    "kind",
    "archived",
  ]),
  index: Schema.optional(Schema.Number),
}) {}

/** A month too far from today to be read: more than ten years before or after it. */
export class MonthOutOfRange extends Schema.TaggedError<MonthOutOfRange>()("MonthOutOfRange", {
  month: Schema.String,
  earliest: Schema.String,
  latest: Schema.String,
}) {}

/**
 * A month after the current one (`current`): what is detected of the subscriptions (#34) is read up
 * to today, and a month to come has nothing paid nor stopped yet.
 */
export class FutureMonthRefused extends Schema.TaggedError<FutureMonthRefused>()(
  "FutureMonthRefused",
  { month: Schema.String, current: Schema.String },
) {}

/** The line was already reviewed: in another tab, by a rule, or by the MCP door. */
export class LineAlreadyReviewed extends Schema.TaggedError<LineAlreadyReviewed>()(
  "LineAlreadyReviewed",
  { lineId: Schema.String },
) {}

/** No account of the user's has this id. */
export class AccountNotFound extends Schema.TaggedError<AccountNotFound>()("AccountNotFound", {
  accountId: Schema.String,
}) {}

/** An account and its institution, as a refusal names them. */
const NamedAccount = Schema.Struct({
  name: Schema.String,
  institution: Schema.NullOr(Schema.String),
});

/** No account of the user's has this name (and institution, when given). */
export class AccountNameUnknown extends Schema.TaggedError<AccountNameUnknown>()(
  "AccountNameUnknown",
  { name: Schema.String, accounts: Schema.Array(NamedAccount) },
) {}

/** Several accounts of the user's have this name: their institutions tell them apart, or not. */
export class AccountNameAmbiguous extends Schema.TaggedError<AccountNameAmbiguous>()(
  "AccountNameAmbiguous",
  { name: Schema.String, matches: Schema.Array(NamedAccount) },
) {}

/**
 * The account's currency cannot change: it has lines or balances, whose amounts would change
 * meaning (docs/data-model.md, "Money").
 */
export class CurrencyLocked extends Schema.TaggedError<CurrencyLocked>()("CurrencyLocked", {
  accountId: Schema.String,
}) {}

/**
 * A card's current account is wrong: a card needs one (`required`), only a card has one
 * (`only_a_card`), and it must be one of the user's open current accounts (`not_open_current`).
 */
export class SettlementRefused extends Schema.TaggedError<SettlementRefused>()(
  "SettlementRefused",
  { reason: Schema.Literals(["required", "only_a_card", "not_open_current"]) },
) {}

/** The account is closed already. */
export class AccountAlreadyClosed extends Schema.TaggedError<AccountAlreadyClosed>()(
  "AccountAlreadyClosed",
  { accountId: Schema.String, closedOn: Schema.String },
) {}

/** The account is open: there is nothing to reopen. */
export class AccountNotClosed extends Schema.TaggedError<AccountNotClosed>()("AccountNotClosed", {
  accountId: Schema.String,
}) {}

/** A balance is noted on an account kept by its balance only; this one is kept by its lines. */
export class AccountKeptByLines extends Schema.TaggedError<AccountKeptByLines>()(
  "AccountKeptByLines",
  { accountId: Schema.String },
) {}

/** The account has a noted balance on that day already: one a day. */
export class BalanceAlreadyNoted extends Schema.TaggedError<BalanceAlreadyNoted>()(
  "BalanceAlreadyNoted",
  { accountId: Schema.String, day: Schema.String },
) {}

/**
 * The category an account kept by its balance sends its movement to (#31) is none of the user's
 * (`unknown`), or is archived and can no longer be chosen (`archived`).
 */
export class BalanceCategoryRefused extends Schema.TaggedError<BalanceCategoryRefused>()(
  "BalanceCategoryRefused",
  { categoryId: Schema.String, reason: Schema.Literals(["unknown", "archived"]) },
) {}

/** The line is no credit: only a counted positive line of a benefit account has an expiry. */
export class NotACredit extends Schema.TaggedError<NotACredit>()("NotACredit", {
  lineId: Schema.String,
}) {}

/** A credit cannot expire before the day it was credited. */
export class ExpiryBeforeCredit extends Schema.TaggedError<ExpiryBeforeCredit>()(
  "ExpiryBeforeCredit",
  { lineId: Schema.String, creditedOn: Schema.String, expiresOn: Schema.String },
) {}

/** No category of the user's has this id. */
export class CategoryNotFound extends Schema.TaggedError<CategoryNotFound>()("CategoryNotFound", {
  categoryId: Schema.String,
}) {}

/** A sibling of the same kind already has this name (any case): the names of a level are unique. */
export class CategoryNameTaken extends Schema.TaggedError<CategoryNameTaken>()(
  "CategoryNameTaken",
  { name: Schema.String },
) {}

/**
 * A change of the categories that the rules refuse (docs/data-model.md, v0.3):
 * - `third_level`: a category goes under one that has a parent, or one with children goes under a
 *   parent, or a merged parent's children would go under a child;
 * - `parent_kind`: the parent, or the merge's target, is of the other kind;
 * - `itself`: a category under itself, or merged into itself;
 * - `archived`: an archived category chosen as a parent, a merge's target or a line's category;
 * - `parent_archived`: a category restored while its parent stays archived;
 * - `fallback`: a fallback archived or merged away, itself or with its parent; `fallback` then
 *   names it, as the user called it;
 * - `name`: a name empty or longer than 100 characters once trimmed, or holding `>`;
 * - `too_many`: the user has 300 categories already, archived ones included;
 * - `benchmark`: a fixed benchmark that is no whole number of minor units from 0;
 * - `icon`: an icon that is no key (lower case letters, digits and `-`, 64 at most);
 * - `position`: a position that is no whole number from 0 to 1,000,000.
 */
export class CategoryRefused extends Schema.TaggedError<CategoryRefused>()("CategoryRefused", {
  reason: Schema.Literals([
    "third_level",
    "parent_kind",
    "itself",
    "archived",
    "parent_archived",
    "fallback",
    "name",
    "too_many",
    "benchmark",
    "icon",
    "position",
  ]),
  fallback: Schema.optional(Schema.String),
}) {}

/** No category of the user's has this name ("Parent > Child" names a child); with every one's. */
export class CategoryNameUnknown extends Schema.TaggedError<CategoryNameUnknown>()(
  "CategoryNameUnknown",
  { name: Schema.String, categories: Schema.Array(Schema.String) },
) {}

/**
 * Several categories of the user's have this name: each path ("Parent > Child") with its kind names
 * one alone.
 */
export class CategoryNameAmbiguous extends Schema.TaggedError<CategoryNameAmbiguous>()(
  "CategoryNameAmbiguous",
  {
    name: Schema.String,
    matches: Schema.Array(
      Schema.Struct({ path: Schema.String, kind: Schema.Literals(["expense", "income"]) }),
    ),
  },
) {}

/**
 * A line's category is chosen through its one entry: a line held, discarded or of no amount has
 * none (`no_entry`), nor has a side of a transfer, which is the transfer (`transfer`, #26), and a
 * line split across several entries is classified entry by entry (`split`).
 */
export class LineNotClassifiable extends Schema.TaggedError<LineNotClassifiable>()(
  "LineNotClassifiable",
  { lineId: Schema.String, reason: Schema.Literals(["no_entry", "transfer", "split"]) },
) {}

/** A line's kind follows its sign: an expense category for money out, an income one for money in. */
export class CategoryKindMismatch extends Schema.TaggedError<CategoryKindMismatch>()(
  "CategoryKindMismatch",
  {
    lineId: Schema.String,
    lineKind: Schema.Literals(["expense", "income"]),
    categoryKind: Schema.Literals(["expense", "income"]),
  },
) {}

/** The days asked for a chart run backwards, or over more days than a chart covers. */
export class DayRangeRefused extends Schema.TaggedError<DayRangeRefused>()("DayRangeRefused", {
  from: Schema.String,
  to: Schema.String,
  maxDays: Schema.Number,
}) {}
