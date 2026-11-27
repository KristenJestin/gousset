import { Schema } from "effect";

// What the investments (#250; docs/data-model.md, v0.6) refuse, for the investments page, the MCP
// door's `investments` tool and the import of a broker's operations alike.

/**
 * A quantity or a unit price that is no exact decimal Gousset keeps: digits with `.` or `,` before
 * at most 10 decimals, at most 15 digits before the point, no sign; a quantity of zero too. `text`
 * is what was given.
 */
export class InvalidQuantity extends Schema.TaggedError<InvalidQuantity>()("InvalidQuantity", {
  text: Schema.String,
}) {}

/**
 * An ISIN that is not one: two letters, nine letters or digits and a digit, whose last digit is its
 * check digit (ISO 6166), so that a typo is refused. `isin` is what was given.
 */
export class InvalidIsin extends Schema.TaggedError<InvalidIsin>()("InvalidIsin", {
  isin: Schema.String,
}) {}

/**
 * An operation goes on an account of the kind `investment` kept by its lines: this one is of
 * another kind (`kind`), or kept by its balance, whose noted balances already make its movements
 * (`balance`).
 */
export class NotAnInvestmentAccount extends Schema.TaggedError<NotAnInvestmentAccount>()(
  "NotAnInvestmentAccount",
  { accountId: Schema.String, reason: Schema.Literals(["kind", "balance"]) },
) {}

/** No security of the user's has this id. */
export class SecurityNotFound extends Schema.TaggedError<SecurityNotFound>()("SecurityNotFound", {
  securityId: Schema.String,
}) {}

/**
 * No operation of the user's has this id; for a read on one account, none of that account's
 * operations (its discarded lines left out) has it.
 */
export class OperationNotFound extends Schema.TaggedError<OperationNotFound>()(
  "OperationNotFound",
  { operationId: Schema.String },
) {}

/** None of the account's operations (its discarded lines left out) names a security of this ISIN. */
export class SecurityNotOnAccount extends Schema.TaggedError<SecurityNotOnAccount>()(
  "SecurityNotOnAccount",
  { accountId: Schema.String, isin: Schema.String },
) {}

/**
 * An operation that does not hold together:
 * - `sign`: its amount goes the wrong way for its kind (a purchase, a fee and a withdrawal take
 *   money out, negative; a sale, a dividend and a deposit bring it in, positive);
 * - `amount`: an amount of zero, or no whole number of minor units;
 * - `fees`: fees that are no whole number of minor units from 0;
 * - `day`: a day or a value day that is no `YYYY-MM-DD`;
 * - `quantity_required`, `quantity_not_allowed`: a purchase and a sale have a quantity and a unit
 *   price, the other kinds neither;
 * - `security_required`, `security_not_allowed`: a purchase, a sale and a dividend name their
 *   security by its ISIN, a deposit and a withdrawal none (a fee may);
 * - `currency`: a security's currency that is no ISO 4217 code.
 */
export class OperationRefused extends Schema.TaggedError<OperationRefused>()("OperationRefused", {
  reason: Schema.Literals([
    "sign",
    "amount",
    "fees",
    "day",
    "quantity_required",
    "quantity_not_allowed",
    "security_required",
    "security_not_allowed",
    "currency",
  ]),
}) {}
