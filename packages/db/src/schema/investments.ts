import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { authUser } from "./auth";
import { statementLine } from "./ledger";

// An investment account's positions by ISIN and their operations (docs/data-model.md, v0.6; #250).
// An operation is a cash line of the account with what the broker says of it: the line keeps the
// amount and the day, the operation its kind, security, quantity, unit price and fees. Their
// row-level security is the ledger's (./ledger.ts); the grants to `gousset_user`, the forced
// policies and the kept key on a security (`on delete no action deferrable initially deferred`,
// which Drizzle cannot write) are in the custom migration `*_investments_isolation`.

/**
 * What an operation is: money coming in or going out of the account (`deposit`, `withdrawal`),
 * cash becoming a position or the reverse (`purchase`, `sale`), or the investment earning or
 * costing (`dividend`, `fee`).
 */
export const operationKind = pgEnum("operation_kind", [
  "deposit",
  "withdrawal",
  "purchase",
  "sale",
  "dividend",
  "fee",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/**
 * A transaction opened for a user sees and writes that user's rows only. With no user set, the
 * setting is empty and no row matches: it fails closed.
 */
const ownRowsOnly = (table: string) =>
  pgPolicy(`${table}_own_rows_only`, {
    as: "permissive",
    for: "all",
    using: sql`"user_id" = current_setting('gousset.user_id', true)`,
    withCheck: sql`"user_id" = current_setting('gousset.user_id', true)`,
  });

/**
 * A security the user holds or held, one per user and ISIN: an ISIN held in two accounts is one
 * security and two positions. Made by the first operation that names its ISIN, kept when its last
 * operation goes. `isin` is null only for a holding without one (#253).
 */
export const security = pgTable.withRLS(
  "security",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    isin: text("isin"),
    // The broker's (or the user's) name of it, 200 characters at most (packages/core).
    name: text("name").notNull(),
    // ISO 4217: the currency it is quoted in, which #251's prices are read in.
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("security_user_id_id_key").on(table.userId, table.id),
    // Nulls distinct: the holdings without an ISIN never collide.
    unique("security_user_id_isin_key").on(table.userId, table.isin),
    check("security_isin_format", sql`${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`),
    check("security_currency_iso_4217", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    ownRowsOnly("security"),
  ],
);

/**
 * What the broker says of one cash line of an investment account. The amount and the day are the
 * line's alone, never copied here. Quantities and unit prices are exact decimals (`numeric`, read
 * as strings), the unit price in the account's currency, as the broker wrote it.
 */
export const investmentOperation = pgTable.withRLS(
  "investment_operation",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    // Its line: deleted with it (an import undone, the operation deleted).
    lineId: uuid("line_id").notNull(),
    kind: operationKind("kind").notNull(),
    // Kept: a security with operations is not deleted (the key is in the custom migration).
    securityId: uuid("security_id"),
    quantity: numeric("quantity"),
    unitPrice: numeric("unit_price"),
    feesMinor: bigint("fees_minor", { mode: "number" }).default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("investment_operation_user_id_id_key").on(table.userId, table.id),
    unique("investment_operation_line_id_key").on(table.lineId),
    foreignKey({
      name: "investment_operation_line_fk",
      columns: [table.userId, table.lineId],
      foreignColumns: [statementLine.userId, statementLine.id],
    }).onDelete("cascade"),
    // A security's operations, for its positions, and the kept key's check.
    index("investment_operation_security_id_idx").on(table.securityId),
    check("investment_operation_quantity_positive", sql`${table.quantity} > 0`),
    check("investment_operation_unit_price_not_negative", sql`${table.unitPrice} >= 0`),
    check("investment_operation_fees_not_negative", sql`${table.feesMinor} >= 0`),
    check(
      "investment_operation_quantity_of_trades",
      sql`(${table.kind} in ('purchase', 'sale')) = (${table.quantity} is not null)`,
    ),
    check(
      "investment_operation_unit_price_of_trades",
      sql`(${table.kind} in ('purchase', 'sale')) = (${table.unitPrice} is not null)`,
    ),
    check(
      "investment_operation_security_of_trades",
      sql`${table.kind} not in ('purchase', 'sale', 'dividend') or ${table.securityId} is not null`,
    ),
    check(
      "investment_operation_no_security_of_cash",
      sql`${table.kind} not in ('deposit', 'withdrawal') or ${table.securityId} is null`,
    ),
    ownRowsOnly("investment_operation"),
  ],
);
