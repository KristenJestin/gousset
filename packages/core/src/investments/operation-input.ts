import { Result, Schema } from "effect";

import { Currency, Day } from "../account-values";
import { compareDecimals, formatDecimal, parseDecimal, ZERO } from "./decimal";
import { InvalidQuantity, OperationRefused } from "./errors";
import type { InvalidIsin } from "./errors";
import { parseIsin } from "./isin";
import type { OperationKind } from "./positions";

// What an operation must hold together, whoever gives it: the user entering or correcting it, or a
// broker's file read (docs/data-model.md, v0.6). Checked before anything is written: the database
// checks the shapes it can, never the sign of a line it cannot read.

/** The longest name a security keeps, once trimmed: a longer one is cut. */
export const MAX_SECURITY_NAME = 200;

/** An operation as given: entered by hand, corrected, or read from a broker's file. */
export type OperationInput = {
  readonly kind: OperationKind;
  /** The day of the trade, as the broker dates the operation: its line's `booked_on`. */
  readonly bookedOn: string;
  /** Its settlement day, when known: its line's `value_on`. */
  readonly valueOn: string | null;
  /** The cash it moved, in minor units of the account's currency, the broker's amount, signed. */
  readonly amountMinor: number;
  /** Its security's ISIN: a purchase's, a sale's and a dividend's; a fee's when it names one. */
  readonly isin: string | null;
  /** The security's name, for a security not known yet; null for its ISIN. */
  readonly securityName: string | null;
  /** The currency it is quoted in, for a security not known yet; null for the account's. */
  readonly securityCurrency: string | null;
  /** A purchase's and a sale's, as written (`0,0347`). */
  readonly quantity: string | null;
  /** A purchase's and a sale's, in the account's currency, as the broker wrote it. */
  readonly unitPrice: string | null;
  /** Fees, or a dividend's withholding tax, in minor units, from 0. */
  readonly feesMinor: number;
  /** The broker's text for the row; null for the security's name. */
  readonly label: string | null;
};

/** An operation that holds together, its quantities written once and for all. */
export type CheckedOperation = {
  readonly kind: OperationKind;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly amountMinor: number;
  readonly security: {
    readonly isin: string;
    readonly name: string | null;
    readonly currency: string | null;
  } | null;
  /** As Postgres writes a `numeric`: a point, no trailing zero. */
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly feesMinor: number;
  readonly label: string | null;
};

/** The kinds that take money out of the account; the others bring it in. */
const OUT: ReadonlySet<OperationKind> = new Set(["purchase", "fee", "withdrawal"]);

const TRADES: ReadonlySet<OperationKind> = new Set(["purchase", "sale"]);

const NAMED: ReadonlySet<OperationKind> = new Set(["purchase", "sale", "dividend"]);

const CASH: ReadonlySet<OperationKind> = new Set(["deposit", "withdrawal"]);

const isDay = Schema.is(Day);

const isCurrency = Schema.is(Currency);

type Refusal = OperationRefused | InvalidQuantity | InvalidIsin;

const refuse = (reason: OperationRefused["reason"]) =>
  Result.fail(new OperationRefused({ reason }));

/** A trade's quantity and unit price, written as Postgres writes them. */
function tradeOf(
  input: OperationInput,
): Result.Result<{ quantity: string | null; unitPrice: string | null }, Refusal> {
  if (!TRADES.has(input.kind)) {
    return input.quantity === null && input.unitPrice === null
      ? Result.succeed({ quantity: null, unitPrice: null })
      : refuse("quantity_not_allowed");
  }

  if (input.quantity === null || input.unitPrice === null) {
    return refuse("quantity_required");
  }

  const { unitPrice } = input;

  return Result.flatMap(parseDecimal(input.quantity), (quantity) =>
    compareDecimals(quantity, ZERO) > 0
      ? Result.map(parseDecimal(unitPrice), (price) => ({
          quantity: formatDecimal(quantity),
          unitPrice: formatDecimal(price),
        }))
      : Result.fail(new InvalidQuantity({ text: input.quantity ?? "" })),
  );
}

/** Its security, by an ISIN whose check digit holds, with the name and currency given. */
function securityOf(input: OperationInput): Result.Result<CheckedOperation["security"], Refusal> {
  if (input.isin === null) {
    return NAMED.has(input.kind) ? refuse("security_required") : Result.succeed(null);
  }

  if (CASH.has(input.kind)) {
    return refuse("security_not_allowed");
  }

  if (input.securityCurrency !== null && !isCurrency(input.securityCurrency)) {
    return refuse("currency");
  }

  const name = (input.securityName ?? "").trim().slice(0, MAX_SECURITY_NAME);
  const currency = input.securityCurrency;

  return Result.map(parseIsin(input.isin), (isin) => ({
    isin,
    name: name === "" ? null : name,
    currency,
  }));
}

/**
 * Checks an operation (docs/data-model.md, v0.6): days of the calendar, an amount of whole minor
 * units that is not zero and goes the way of its kind (`sign`), fees of whole minor units from 0, a
 * quantity above zero and a unit price for a purchase and a sale alone, an ISIN whose check digit
 * holds for a purchase, a sale and a dividend (a fee's may name one, a deposit's and a
 * withdrawal's none), an ISO 4217 code for a security's currency. A security's name is trimmed and
 * cut to 200 characters.
 */
export function checkOperation(input: OperationInput): Result.Result<CheckedOperation, Refusal> {
  if (!isDay(input.bookedOn) || (input.valueOn !== null && !isDay(input.valueOn))) {
    return refuse("day");
  }

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) {
    return refuse("amount");
  }

  if (OUT.has(input.kind) !== input.amountMinor < 0) {
    return refuse("sign");
  }

  if (!Number.isSafeInteger(input.feesMinor) || input.feesMinor < 0) {
    return refuse("fees");
  }

  return Result.flatMap(tradeOf(input), (trade) =>
    Result.map(securityOf(input), (security) => ({
      kind: input.kind,
      bookedOn: input.bookedOn,
      valueOn: input.valueOn,
      amountMinor: input.amountMinor,
      security,
      quantity: trade.quantity,
      unitPrice: trade.unitPrice,
      feesMinor: input.feesMinor,
      label: input.label,
    })),
  );
}
