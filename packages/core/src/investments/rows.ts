import { investmentOperation, security } from "@gousset/db/schema/investments";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import type { UserTransaction } from "@gousset/db/user-data";
import { minorDigits } from "@gousset/currency";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Result } from "effect";

import type { Money } from "../month";
import { formatDecimal, parseDecimal } from "./decimal";
import type { Decimal } from "./decimal";
import { averageCost, isOpen, positionOf } from "./positions";
import type { OperationKind, Position, PositionOperation } from "./positions";

// The rows of the investments (docs/data-model.md, v0.6) as their reads and writes meet them, in a
// transaction of the user's (`UserData`). Every value goes in as a parameter.

/** A security, as every read names it. */
export type SecurityRead = {
  readonly id: string;
  /** Null only for a holding without one (#253). */
  readonly isin: string | null;
  readonly name: string;
  /** The currency it is quoted in. */
  readonly currency: string;
};

/** An exact amount for one unit, in a currency's units, to 10 decimals: `112.4519` EUR. */
export type UnitAmount = { readonly value: string; readonly currency: string };

/** One security held on one account, at cost (docs/data-model.md, v0.6, positions). */
export type PositionRead = {
  readonly security: SecurityRead;
  /** Exact, as Postgres writes it; below zero for an incomplete position. */
  readonly quantity: string;
  /** What one unit held cost, in the account's currency; null when nothing is held. */
  readonly averageCost: UnitAmount | null;
  /** What the quantity held cost, fees included, in the account's currency. */
  readonly cost: Money;
  /** More was sold than held: some earlier operations are missing. */
  readonly incomplete: boolean;
  /** False once its quantity reached zero: it is closed, its operations stay. */
  readonly open: boolean;
};

/** An operation as the investments page and the MCP door read it, with its line's day and cash. */
export type OperationRead = {
  readonly id: string;
  /** Its cash line, which carries its day and amount. */
  readonly lineId: string;
  readonly accountId: string;
  readonly kind: OperationKind;
  /** The day of the trade. */
  readonly bookedOn: string;
  /** Its settlement day, when known. */
  readonly valueOn: string | null;
  /** The cash it moved, signed, in the account's currency. */
  readonly amount: Money;
  /** Its fees, or a dividend's withholding tax. */
  readonly fees: Money;
  readonly quantity: string | null;
  /** In the account's currency, as the broker wrote it. */
  readonly unitPrice: UnitAmount | null;
  readonly security: SecurityRead | null;
  /** The broker's text, else the security's name, else empty: the interface names it otherwise. */
  readonly label: string;
  /** `import` (read from a broker's file) or `manual` (entered by hand). */
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly state: "counted" | "held" | "discarded";
  /** A deposit or a withdrawal paired with the other account's line as a transfer. */
  readonly paired: boolean;
};

/** The line is a side of a transfer. */
const transferSide = sql<boolean>`exists (select 1 from ${transfer} where ${transfer.outLineId} = ${statementLine.id} or ${transfer.inLineId} = ${statementLine.id})`;

const operationColumns = {
  id: investmentOperation.id,
  lineId: statementLine.id,
  accountId: statementLine.accountId,
  kind: investmentOperation.kind,
  bookedOn: statementLine.bookedOn,
  valueOn: statementLine.valueOn,
  amountMinor: statementLine.amountMinor,
  label: statementLine.label,
  source: statementLine.source,
  state: statementLine.state,
  quantity: investmentOperation.quantity,
  unitPrice: investmentOperation.unitPrice,
  feesMinor: investmentOperation.feesMinor,
  securityId: security.id,
  isin: security.isin,
  securityName: security.name,
  securityCurrency: security.currency,
  currency: account.currency,
  paired: transferSide,
};

/** The operations `where` selects, each with its line, its account's currency and its security. */
export function selectOperations(transaction: UserTransaction) {
  return transaction
    .select(operationColumns)
    .from(investmentOperation)
    .innerJoin(statementLine, eq(statementLine.id, investmentOperation.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .leftJoin(security, eq(security.id, investmentOperation.securityId));
}

type OperationRow = Awaited<ReturnType<typeof selectOperations>>[number];

/** A decimal Postgres wrote: always one Gousset wrote, within its limits. */
function decimalFrom(text: string): Decimal {
  return Result.getOrThrow(parseDecimal(text));
}

function securityFrom(row: {
  readonly securityId: string | null;
  readonly isin: string | null;
  readonly securityName: string | null;
  readonly securityCurrency: string | null;
}): SecurityRead | null {
  return row.securityId === null || row.securityName === null || row.securityCurrency === null
    ? null
    : {
        id: row.securityId,
        isin: row.isin,
        name: row.securityName,
        currency: row.securityCurrency,
      };
}

export function operationOf(row: OperationRow): OperationRead {
  return {
    id: row.id,
    lineId: row.lineId,
    accountId: row.accountId,
    kind: row.kind,
    bookedOn: row.bookedOn,
    valueOn: row.valueOn,
    amount: { minor: row.amountMinor, currency: row.currency },
    fees: { minor: row.feesMinor, currency: row.currency },
    quantity: row.quantity === null ? null : formatDecimal(decimalFrom(row.quantity)),
    unitPrice:
      row.unitPrice === null
        ? null
        : { value: formatDecimal(decimalFrom(row.unitPrice)), currency: row.currency },
    security: securityFrom(row),
    label: row.label,
    source: row.source,
    state: row.state,
    paired: row.paired,
  };
}

/** The operation with this id, or undefined. */
export async function readOperation(
  transaction: UserTransaction,
  operationId: string,
): Promise<OperationRead | undefined> {
  const [row] = await selectOperations(transaction).where(eq(investmentOperation.id, operationId));

  return row === undefined ? undefined : operationOf(row);
}

/** A position as it is read: its security, figures rounded only where they meet money. */
export function positionReadOf(
  read: SecurityRead,
  position: Position,
  currency: string,
): PositionRead {
  const minorUnits = minorDigits(currency);

  return {
    security: read,
    quantity: formatDecimal(position.quantity),
    averageCost:
      position.quantity.scaled > 0n
        ? { value: formatDecimal(averageCost(position, minorUnits)), currency }
        : null,
    cost: { minor: position.costMinor, currency },
    incomplete: position.incomplete,
    open: isOpen(position),
  };
}

/** A security's operations on one account, as a position reads them. */
type Held = {
  readonly accountId: string;
  readonly security: SecurityRead;
  readonly currency: string;
  readonly operations: Array<PositionOperation>;
};

/**
 * The positions of the accounts `where` selects (open and closed), from the operations of their
 * counted lines booked on or before `day`, in their lines' order.
 */
export async function positionsIn(
  transaction: UserTransaction,
  day: string,
  where: SQL | undefined,
): Promise<ReadonlyArray<{ readonly accountId: string; readonly position: PositionRead }>> {
  const rows = await selectOperations(transaction).where(
    and(
      eq(statementLine.state, "counted"),
      sql`${statementLine.bookedOn} <= ${day}`,
      sql`${investmentOperation.securityId} is not null`,
      where,
    ),
  );

  const held = new Map<string, Held>();

  for (const row of rows) {
    const read = securityFrom(row);

    if (read === null) {
      continue;
    }

    const key = `${row.accountId} ${read.id}`;

    const each = held.get(key) ?? {
      accountId: row.accountId,
      security: read,
      currency: row.currency,
      operations: [],
    };

    each.operations.push({
      kind: row.kind,
      bookedOn: row.bookedOn,
      lineId: row.lineId,
      amountMinor: row.amountMinor,
      quantity: row.quantity === null ? null : decimalFrom(row.quantity),
    });
    held.set(key, each);
  }

  return [...held.values()]
    .map((each) => ({
      accountId: each.accountId,
      position: positionReadOf(each.security, positionOf(each.operations), each.currency),
    }))
    .toSorted(
      (a, b) =>
        a.position.security.name.localeCompare(b.position.security.name) ||
        a.position.security.id.localeCompare(b.position.security.id),
    );
}

/** Why an operation cannot go on an account: none of the user's, or no investment kept by lines. */
export type AccountRefusal = { readonly missing: string } | AccountRefused;

/** An account of the user's of another kind than `investment`, or kept by its balance. */
export type AccountRefused = { readonly refused: "kind" | "balance"; readonly accountId: string };

/**
 * The account an operation goes on, with its currency: an account of the user's of the kind
 * `investment`, kept by its lines (docs/data-model.md, v0.6). Otherwise why not.
 */
export async function investmentAccountIn(
  transaction: UserTransaction,
  accountId: string,
): Promise<
  { readonly account: { readonly id: string; readonly currency: string } } | AccountRefusal
> {
  const [found] = await transaction
    .select({ id: account.id, kind: account.kind, mode: account.mode, currency: account.currency })
    .from(account)
    .where(eq(account.id, accountId));

  if (found === undefined) {
    return { missing: accountId };
  }

  if (found.kind !== "investment") {
    return { refused: "kind", accountId: found.id };
  }

  return found.mode === "lines"
    ? { account: { id: found.id, currency: found.currency } }
    : { refused: "balance", accountId: found.id };
}

/** A security an operation names: its ISIN, and the name and currency it is made with if new. */
export type NamedSecurity = {
  readonly isin: string;
  readonly name: string | null;
  readonly currency: string | null;
};

/**
 * The user's securities of these ISINs, by ISIN, each made when none has it yet (docs/data-model.md,
 * v0.6: one per user and ISIN, made by the first operation that names it), named as given or by its
 * ISIN, quoted in the currency given or `currency`. One already there keeps its name and currency.
 * Two transactions making the same one at once: the second waits for the first, then finds it.
 */
export async function securitiesFor(
  transaction: UserTransaction,
  owner: string,
  named: ReadonlyArray<NamedSecurity>,
  currency: string,
): Promise<ReadonlyMap<string, SecurityRead>> {
  const first = new Map<string, NamedSecurity>();

  for (const each of named) {
    if (!first.has(each.isin)) {
      first.set(each.isin, each);
    }
  }

  if (first.size === 0) {
    return new Map();
  }

  await transaction
    .insert(security)
    .values(
      [...first.values()].map((each) => ({
        userId: owner,
        isin: each.isin,
        name: each.name ?? each.isin,
        currency: each.currency ?? currency,
      })),
    )
    .onConflictDoNothing({ target: [security.userId, security.isin] });

  const found = await transaction
    .select({
      securityId: security.id,
      isin: security.isin,
      securityName: security.name,
      securityCurrency: security.currency,
    })
    .from(security)
    .where(inArray(security.isin, [...first.keys()]));

  const byIsin = new Map<string, SecurityRead>();

  for (const row of found) {
    const read = securityFrom(row);

    if (read !== null && row.isin !== null) {
      byIsin.set(row.isin, read);
    }
  }

  return byIsin;
}

/** Whether the line is a side of a transfer. */
export async function pairedLine(transaction: UserTransaction, lineId: string): Promise<boolean> {
  const [found] = await transaction
    .select({ id: transfer.id })
    .from(transfer)
    .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

  return found !== undefined;
}
