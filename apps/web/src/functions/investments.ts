import {
  correctInvestmentOperation,
  deleteInvestmentOperation,
  enterInvestmentOperation,
  investmentAccounts,
  investmentOperations,
  today,
} from "@gousset/core";
import type { OperationRead } from "@gousset/core";
import { AccountId } from "@gousset/core/account-values";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn, slowedInDevelopment } from "./month";

/**
 * Why an operation was refused, as a code for the interface to translate (`OperationRefused`'s
 * reasons, the other errors' tags); `text` is what an `InvalidQuantity` was given, so that the
 * page says it under the field that holds it. A failure of the server itself is thrown.
 */
export type OperationRefusalCode =
  | "ACCOUNT_NOT_FOUND"
  | "NOT_AN_INVESTMENT_ACCOUNT"
  | "KEPT_BY_BALANCE"
  | "OPERATION_NOT_FOUND"
  | "INVALID_ISIN"
  | "INVALID_QUANTITY"
  | "SIGN"
  | "AMOUNT"
  | "FEES"
  | "DAY"
  | "QUANTITY_REQUIRED"
  | "QUANTITY_NOT_ALLOWED"
  | "SECURITY_REQUIRED"
  | "SECURITY_NOT_ALLOWED"
  | "CURRENCY";

const refused = (code: OperationRefusalCode, text?: string) =>
  Effect.succeed({ ok: false as const, code, text });

const REASON_CODES = {
  sign: "SIGN",
  amount: "AMOUNT",
  fees: "FEES",
  day: "DAY",
  quantity_required: "QUANTITY_REQUIRED",
  quantity_not_allowed: "QUANTITY_NOT_ALLOWED",
  security_required: "SECURITY_REQUIRED",
  security_not_allowed: "SECURITY_NOT_ALLOWED",
  currency: "CURRENCY",
} as const;

const ACCOUNT_CODES = { kind: "NOT_AN_INVESTMENT_ACCOUNT", balance: "KEPT_BY_BALANCE" } as const;

/**
 * An operation as the page sends it (`OperationInput`): only its shape is checked here, so that
 * what does not hold together (a day off the calendar, a zero amount, a typo in an ISIN) comes back
 * from `@gousset/core` as a refusal the page words, rather than as a failed request.
 */
const OperationFields = Schema.Struct({
  kind: Schema.Literals(["deposit", "withdrawal", "purchase", "sale", "dividend", "fee"]),
  bookedOn: Schema.String,
  amountMinor: Schema.Number,
  isin: Schema.NullOr(Schema.String),
  securityName: Schema.NullOr(Schema.String),
  quantity: Schema.NullOr(Schema.String),
  unitPrice: Schema.NullOr(Schema.String),
  feesMinor: Schema.Number,
});

type OperationFields = typeof OperationFields.Type;

/** Entered by hand: no value day, the account's currency for a new security, no broker's text. */
const inputOf = (fields: OperationFields) => ({
  ...fields,
  valueOn: null,
  securityCurrency: null,
  label: null,
});

const done = (operation: OperationRead) => ({ ok: true as const, operation });

/** What an operation entered or corrected is refused for, from the errors of `@gousset/core`. */
const writeRefusals = {
  NotAnInvestmentAccount: (refusal: { readonly reason: "kind" | "balance" }) =>
    refused(ACCOUNT_CODES[refusal.reason]),
  OperationRefused: (refusal: { readonly reason: keyof typeof REASON_CODES }) =>
    refused(REASON_CODES[refusal.reason]),
  InvalidIsin: () => refused("INVALID_ISIN"),
  InvalidQuantity: (refusal: { readonly text: string }) =>
    refused("INVALID_QUANTITY", refusal.text),
};

/**
 * The investments page: the user's investment accounts, open and closed, each with its cash and
 * its open positions at cost, and today, the day an operation entered starts from.
 */
export const getInvestments = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .handler(({ context }) =>
    runCore(
      Effect.gen(function* () {
        const accounts = yield* investmentAccounts(context.owner);
        const day = yield* today;

        return { day, accounts };
      }),
    ),
  );

const OperationPageInput = Schema.Struct({
  accountId: AccountId,
  /** The operation the page before ended on, as its `next` gave it. */
  after: Schema.NullOr(Schema.String),
});

/** A page of an account's operations, newest first; an account the user does not have, a code. */
export const getInvestmentOperations = createServerFn({ method: "GET" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(OperationPageInput))
  .handler(({ data, context }) =>
    runCore(
      investmentOperations(context.owner, data.accountId, { after: data.after }).pipe(
        Effect.map((page) => ({ ok: true as const, page })),
        Effect.catchTags({ AccountNotFound: () => refused("ACCOUNT_NOT_FOUND") }),
      ),
    ),
  );

/** Enters an operation by hand on an investment account kept by its lines; a refusal, a code. */
export const enterOperation = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ accountId: AccountId, operation: OperationFields })),
  )
  .handler(({ data, context }) =>
    runCore(
      enterInvestmentOperation(context.owner, data.accountId, inputOf(data.operation)).pipe(
        Effect.map(done),
        Effect.catchTags({
          ...writeRefusals,
          AccountNotFound: () => refused("ACCOUNT_NOT_FOUND"),
        }),
      ),
    ),
  );

/** Corrects an operation and its line together; a refusal, a code. */
export const correctOperation = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ operationId: Schema.String, operation: OperationFields }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      correctInvestmentOperation(context.owner, data.operationId, inputOf(data.operation)).pipe(
        Effect.map(done),
        Effect.catchTags({
          ...writeRefusals,
          OperationNotFound: () => refused("OPERATION_NOT_FOUND"),
        }),
      ),
    ),
  );

/** Deletes an operation and its line; one the user does not have, a code. */
export const deleteOperation = createServerFn({ method: "POST" })
  .middleware([signedIn, slowedInDevelopment])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ operationId: Schema.String })))
  .handler(({ data, context }) =>
    runCore(
      deleteInvestmentOperation(context.owner, data.operationId).pipe(
        Effect.map(done),
        Effect.catchTags({ OperationNotFound: () => refused("OPERATION_NOT_FOUND") }),
      ),
    ),
  );
