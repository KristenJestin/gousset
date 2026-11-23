import { Schema } from "effect";

/** No line of the user's has this id. */
export class LineNotFound extends Schema.TaggedError<LineNotFound>()("LineNotFound", {
  lineId: Schema.String,
}) {}

/** A month too far from today to be read: more than ten years before or after it. */
export class MonthOutOfRange extends Schema.TaggedError<MonthOutOfRange>()("MonthOutOfRange", {
  month: Schema.String,
  earliest: Schema.String,
  latest: Schema.String,
}) {}

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

/** The line is no credit: only a counted positive line of a benefit account has an expiry. */
export class NotACredit extends Schema.TaggedError<NotACredit>()("NotACredit", {
  lineId: Schema.String,
}) {}

/** A credit cannot expire before the day it was credited. */
export class ExpiryBeforeCredit extends Schema.TaggedError<ExpiryBeforeCredit>()(
  "ExpiryBeforeCredit",
  { lineId: Schema.String, creditedOn: Schema.String, expiresOn: Schema.String },
) {}

/** The days asked for a chart run backwards, or over more days than a chart covers. */
export class DayRangeRefused extends Schema.TaggedError<DayRangeRefused>()("DayRangeRefused", {
  from: Schema.String,
  to: Schema.String,
  maxDays: Schema.Number,
}) {}
