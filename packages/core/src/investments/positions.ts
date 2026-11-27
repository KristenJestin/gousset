import type { operationKind } from "@gousset/db/schema/investments";

import { ZERO, add, decimalOf, perUnit, roundDivide, subtract } from "./decimal";
import type { Decimal } from "./decimal";

// Positions are computed on read, never stored (docs/data-model.md, v0.6): from the operations of
// one account and one security, in the order of their lines, counted lines only. A purchase adds
// its quantity and its cost (the money it took, fees included); a sale takes off its quantity and
// the share of the cost it held (cost × sold / held, rounded to the nearest minor unit, half away
// from zero), so that the average cost does not move with a sale: the weighted average cost a
// French broker shows (prix de revient unitaire). A dividend and a fee leave both alone.

/** What an operation is (`operation_kind`). */
export type OperationKind = (typeof operationKind.enumValues)[number];

/** An operation as a position reads it: its kind, its line's day, id and amount, its quantity. */
export type PositionOperation = {
  readonly kind: OperationKind;
  readonly bookedOn: string;
  readonly lineId: string;
  /** Its line's amount, in minor units of the account's currency: negative for a purchase. */
  readonly amountMinor: number;
  /** A purchase's or a sale's; null for the other kinds. */
  readonly quantity: Decimal | null;
};

/** One security held on one account, at cost. */
export type Position = {
  /** Below zero when more was sold than held: the position is then incomplete. */
  readonly quantity: Decimal;
  /** What the quantity held cost, in minor units of the account's currency. */
  readonly costMinor: number;
  /**
   * A sale took more than was held (a history imported from its middle): some earlier operations
   * are missing, and the figures say so from then on, whatever comes after.
   */
  readonly incomplete: boolean;
};

const inLineOrder = (a: PositionOperation, b: PositionOperation) =>
  a.bookedOn.localeCompare(b.bookedOn) || a.lineId.localeCompare(b.lineId);

function next(position: Position, operation: PositionOperation): Position {
  const quantity = operation.quantity ?? ZERO;

  switch (operation.kind) {
    case "purchase": {
      return {
        quantity: add(position.quantity, quantity),
        costMinor: position.costMinor - operation.amountMinor,
        incomplete: position.incomplete,
      };
    }

    case "sale": {
      const held = position.quantity.scaled;

      // More sold than held: the cost goes to nothing and the quantity below it, rather than the
      // file being refused.
      if (quantity.scaled > held) {
        return { quantity: subtract(position.quantity, quantity), costMinor: 0, incomplete: true };
      }

      const share = Number(roundDivide(BigInt(position.costMinor) * quantity.scaled, held));

      return {
        quantity: subtract(position.quantity, quantity),
        costMinor: position.costMinor - share,
        incomplete: position.incomplete,
      };
    }

    case "deposit":
    case "withdrawal":
    case "dividend":
    case "fee": {
      return position;
    }
  }
}

/** The position the operations of one account and one security make, read in their lines' order. */
export function positionOf(operations: ReadonlyArray<PositionOperation>): Position {
  return operations
    .toSorted(inLineOrder)
    .reduce(next, { quantity: decimalOf(0n), costMinor: 0, incomplete: false });
}

/** Whether it is still held: one whose quantity reached zero is closed, and leaves the list. */
export const isOpen = (position: Position): boolean => position.quantity.scaled !== 0n;

/**
 * What one unit held cost (its cost over its quantity), in the account's currency, to 10 decimals.
 * Only for a position that holds something (`quantity` above zero).
 */
export const averageCost = (position: Position, minorUnits: number): Decimal =>
  perUnit(position.costMinor, minorUnits, position.quantity);
