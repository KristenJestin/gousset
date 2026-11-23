import {
  closeAccount as closeCoreAccount,
  createAccount as createCoreAccount,
  editAccount as editCoreAccount,
  listAccounts,
  noteBalance,
  reopenAccount as reopenCoreAccount,
  setCreditExpiry as setCoreCreditExpiry,
  showAccount,
} from "@gousset/core";
import {
  AccountId,
  AccountInput,
  CreditExpiryInput,
  Day,
  MAX_LINES,
  NotedBalanceInput,
} from "@gousset/core/account-values";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/**
 * Why a write or a read of an account was refused, as a code for the interface to translate. A
 * failure of the server itself is thrown, not answered with a code.
 */
export type AccountRefusalCode =
  | "ACCOUNT_NOT_FOUND"
  | "CURRENCY_LOCKED"
  | "SETTLES_INTO_REQUIRED"
  | "SETTLES_INTO_ONLY_FOR_A_CARD"
  | "SETTLES_INTO_NOT_AN_OPEN_CURRENT_ACCOUNT"
  | "ACCOUNT_ALREADY_CLOSED"
  | "ACCOUNT_NOT_CLOSED"
  | "ACCOUNT_KEPT_BY_LINES"
  | "BALANCE_ALREADY_NOTED"
  | "DAY_RANGE_INVALID"
  | "LINE_NOT_FOUND"
  | "NOT_A_CREDIT"
  | "EXPIRY_BEFORE_CREDIT";

const refused = (code: AccountRefusalCode) => Effect.succeed({ ok: false as const, code });

const SETTLEMENT_CODES = {
  required: "SETTLES_INTO_REQUIRED",
  only_a_card: "SETTLES_INTO_ONLY_FOR_A_CARD",
  not_open_current: "SETTLES_INTO_NOT_AN_OPEN_CURRENT_ACCOUNT",
} as const;

/** The accounts page: the four groups with their totals per currency, then the closed accounts. */
export const getAccounts = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) => runCore(listAccounts(context.owner)));

const AccountPage = Schema.Struct({
  accountId: AccountId,
  /** Lines older than this one, as a page's `olderBefore` gave it. */
  before: Schema.optional(AccountId),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_LINES }))),
  from: Schema.optional(Day),
  to: Schema.optional(Day),
});

/**
 * An account's page: its settings, balance today, lines newest first with the balance after each,
 * its balance day by day, and the check against its latest statement balance. An account the user
 * does not have, or days a chart cannot cover, come back as a code.
 */
export const getAccount = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(AccountPage))
  .handler(({ data, context }) => {
    const { accountId, ...view } = data;

    return runCore(
      showAccount(context.owner, accountId, view).pipe(
        Effect.map((account) => ({ ok: true as const, account })),
        Effect.catchTags({
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
          DayRangeRefused: () => refused("DAY_RANGE_INVALID"),
        }),
      ),
    );
  });

/** Creates an account; a card's current account that is not right comes back as a code. */
export const createAccount = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(AccountInput))
  .handler(({ data, context }) =>
    runCore(
      createCoreAccount(context.owner, data).pipe(
        Effect.map((account) => ({ ok: true as const, id: account.id })),
        Effect.catchTags({
          SettlementRefused: (refusal) => refused(SETTLEMENT_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/**
 * Changes an account's settings, all at once. Refused with a code: an account the user does not
 * have, a new currency once it has a line or a balance, a card's current account that is not right.
 */
export const editAccount = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ accountId: AccountId, settings: AccountInput })),
  )
  .handler(({ data, context }) =>
    runCore(
      editCoreAccount(context.owner, data.accountId, data.settings).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
          CurrencyLocked: () => refused("CURRENCY_LOCKED"),
          SettlementRefused: (refusal) => refused(SETTLEMENT_CODES[refusal.reason]),
        }),
      ),
    ),
  );

/** Closes an account on a day: it keeps its lines and leaves the totals. */
export const closeAccount = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ accountId: AccountId, closedOn: Day })))
  .handler(({ data, context }) =>
    runCore(
      closeCoreAccount(context.owner, data.accountId, data.closedOn).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
          AccountAlreadyClosed: () => refused("ACCOUNT_ALREADY_CLOSED"),
        }),
      ),
    ),
  );

/** Reopens a closed account. */
export const reopenAccount = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ accountId: AccountId })))
  .handler(({ data, context }) =>
    runCore(
      reopenCoreAccount(context.owner, data.accountId).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
          AccountNotClosed: () => refused("ACCOUNT_NOT_CLOSED"),
        }),
      ),
    ),
  );

/** Notes the balance at the end of a day on an account kept by its balance: one a day. */
export const noteAccountBalance = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(NotedBalanceInput))
  .handler(({ data, context }) =>
    runCore(
      noteBalance(context.owner, data.accountId, data.day, data.balanceMinor).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
          AccountKeptByLines: () => refused("ACCOUNT_KEPT_BY_LINES"),
          BalanceAlreadyNoted: () => refused("BALANCE_ALREADY_NOTED"),
        }),
      ),
    ),
  );

/**
 * Sets the day a benefit account's credit expires, or takes it away with `null`. Refused with a
 * code: a line the user does not have, a line that is no credit, a day before the one credited.
 */
export const setCreditExpiry = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(CreditExpiryInput))
  .handler(({ data, context }) =>
    runCore(
      setCoreCreditExpiry(context.owner, data.lineId, data.expiresOn).pipe(
        Effect.map(() => ({ ok: true as const })),
        Effect.catchTags({
          LineNotFound: () => refused("LINE_NOT_FOUND"),
          NotACredit: () => refused("NOT_A_CREDIT"),
          ExpiryBeforeCredit: () => refused("EXPIRY_BEFORE_CREDIT"),
        }),
      ),
    ),
  );
