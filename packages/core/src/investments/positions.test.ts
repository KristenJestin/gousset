import { Result } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { decimalOf, formatDecimal, parseDecimal } from "./decimal";
import type { Decimal } from "./decimal";
import { averageCost, isOpen, positionOf } from "./positions";
import type { PositionOperation } from "./positions";

// A position computed on read from its operations (docs/data-model.md, v0.6): the weighted average
// cost a French broker shows, a sale taking off the share of the cost it held. Every amount and
// quantity here is invented.

const units = (text: string): Decimal => Result.getOrThrow(parseDecimal(text));

let made = 0;

function operation(
  kind: PositionOperation["kind"],
  bookedOn: string,
  amountMinor: number,
  quantity: string | null = null,
): PositionOperation {
  made += 1;

  return {
    kind,
    bookedOn,
    lineId: `line-${String(made).padStart(6, "0")}`,
    amountMinor,
    quantity: quantity === null ? null : units(quantity),
  };
}

const shown = (operations: ReadonlyArray<PositionOperation>) => {
  const position = positionOf(operations);

  return {
    quantity: formatDecimal(position.quantity),
    costMinor: position.costMinor,
    averageCost: position.quantity.scaled > 0n ? formatDecimal(averageCost(position, 2)) : null,
    incomplete: position.incomplete,
    open: isOpen(position),
  };
};

describe("a position", () => {
  test("adds what each purchase bought and cost, its fees included", () => {
    expect(
      shown([
        operation("purchase", "2026-09-14", -33_599, "2.9791"),
        operation("purchase", "2026-10-14", -33_560, "2.9416"),
      ]),
    ).toEqual({
      quantity: "5.9207",
      costMinor: 67_159,
      averageCost: "113.4308443258",
      incomplete: false,
      open: true,
    });
  });

  test("takes off a sale's share of the cost, so that its average cost does not move", () => {
    expect(
      shown([
        operation("purchase", "2026-09-14", -30_000, "3"),
        operation("purchase", "2026-09-20", -10_000, "1"),
        operation("sale", "2026-10-02", 12_500, "1"),
      ]),
    ).toEqual({
      quantity: "3",
      costMinor: 30_000,
      averageCost: "100",
      incomplete: false,
      open: true,
    });
  });

  test("rounds a sale's share of the cost to the nearest minor unit, half away from zero", () => {
    // 100.01 € for 3 units, a third sold: 33.336… € off, 33.34 € rounded.
    expect(
      shown([
        operation("purchase", "2026-09-14", -10_001, "3"),
        operation("sale", "2026-09-15", 4000, "1"),
      ]),
    ).toMatchObject({ quantity: "2", costMinor: 6667 });

    // 1.01 € for 2 units, one sold: 0.505 € off, 0.51 € rounded.
    expect(
      shown([
        operation("purchase", "2026-09-14", -101, "2"),
        operation("sale", "2026-09-15", 60, "1"),
      ]),
    ).toMatchObject({ quantity: "1", costMinor: 50 });
  });

  test("is left alone by a dividend and a fee", () => {
    const bought = [operation("purchase", "2026-09-14", -33_599, "2.9791")];

    expect(
      shown([
        ...bought,
        operation("dividend", "2026-09-30", 1840),
        operation("fee", "2026-09-30", -150),
      ]),
    ).toEqual(shown(bought));
  });

  test("is closed once all is sold, and its cost is then nothing", () => {
    expect(
      shown([
        operation("purchase", "2026-09-14", -33_599, "2.9791"),
        operation("sale", "2026-10-20", 34_102, "2.9791"),
      ]),
    ).toEqual({ quantity: "0", costMinor: 0, averageCost: null, incomplete: false, open: false });
  });

  test("is incomplete when more is sold than held: a history imported from its middle", () => {
    expect(
      shown([
        operation("purchase", "2026-09-14", -10_000, "1"),
        operation("sale", "2026-10-20", 25_000, "2.5"),
      ]),
    ).toEqual({
      quantity: "-1.5",
      costMinor: 0,
      averageCost: null,
      incomplete: true,
      open: true,
    });

    // It stays so: the operations missing are still missing.
    expect(
      shown([
        operation("sale", "2026-09-01", 10_000, "1"),
        operation("purchase", "2026-09-14", -20_000, "2"),
      ]),
    ).toMatchObject({ quantity: "1", costMinor: 20_000, incomplete: true });
  });

  test("reads its operations in the order of their lines: booked on, then id", () => {
    const sale = operation("sale", "2026-10-02", 12_500, "1");
    const first = operation("purchase", "2026-09-14", -10_000, "1");
    const second = operation("purchase", "2026-09-14", -30_000, "1");

    expect(shown([sale, second, first])).toEqual(shown([first, second, sale]));
  });
});

/** A quantity of 0.0001 to 10,000 units, with up to 4 decimals. */
const someUnits = fc
  .integer({ min: 1, max: 100_000_000 })
  .map((tenThousandths) => decimalOf(BigInt(tenThousandths) * 1_000_000n));

/** An amount of 0.01 to 1,000,000.00. */
const someMinor = fc.integer({ min: 1, max: 100_000_000 });

/** A purchase of each quantity at each cost, one a day in January. */
const bought = (each: ReadonlyArray<[Decimal, number]>): ReadonlyArray<PositionOperation> =>
  each.map(([held, minor], index) => ({
    ...operation("purchase", `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, -minor),
    quantity: held,
  }));

describe("positions, whatever the purchases", () => {
  const purchases = fc.array(fc.tuple(someUnits, someMinor), { minLength: 1, maxLength: 20 });

  test("hold what was bought, at what it cost", () => {
    fc.assert(
      fc.property(purchases, (each) => {
        const position = positionOf(bought(each));

        expect(position.quantity.scaled).toBe(each.reduce((sum, [held]) => sum + held.scaled, 0n));
        expect(position.costMinor).toBe(each.reduce((sum, [, minor]) => sum + minor, 0));
        expect(position.incomplete).toBe(false);
      }),
    );
  });

  test("sold whole, hold nothing and cost nothing", () => {
    fc.assert(
      fc.property(purchases, someMinor, (each, received) => {
        const operations = bought(each);
        const held = positionOf(operations).quantity;
        const sale = { ...operation("sale", "2026-12-31", received), quantity: held };
        const position = positionOf([...operations, sale]);

        expect(position).toEqual({ quantity: decimalOf(0n), costMinor: 0, incomplete: false });
        expect(isOpen(position)).toBe(false);
      }),
    );
  });

  test("sold in part, keep their average cost, to half a minor unit of what is left", () => {
    fc.assert(
      fc.property(
        purchases,
        fc.integer({ min: 1, max: 999 }),
        someMinor,
        (each, thousandths, received) => {
          const operations = bought(each);
          const before = positionOf(operations);
          // Part of what is held, at least one ten-thousandth of a unit short of all of it.
          const sold = decimalOf((before.quantity.scaled * BigInt(thousandths)) / 1000n);

          fc.pre(sold.scaled > 0n && sold.scaled < before.quantity.scaled);

          const sale = { ...operation("sale", "2026-12-31", received), quantity: sold };
          const after = positionOf([...operations, sale]);
          const left = before.quantity.scaled - sold.scaled;

          expect(after.quantity.scaled).toBe(left);

          // The cost left is the cost before for what is left, to half a minor unit: the average
          // cost is unchanged but for that rounding.
          const off =
            BigInt(after.costMinor) * before.quantity.scaled - BigInt(before.costMinor) * left;

          expect(2n * (off < 0n ? -off : off) <= before.quantity.scaled).toBe(true);
        },
      ),
    );
  });

  test("are left alone by dividends and fees, wherever they come", () => {
    fc.assert(
      fc.property(purchases, fc.array(someMinor, { maxLength: 5 }), (each, others) => {
        const operations = bought(each);

        const income = others.map((minor, index) =>
          index % 2 === 0
            ? operation("dividend", "2026-01-15", minor)
            : operation("fee", "2026-01-15", -minor),
        );

        expect(positionOf([...operations, ...income])).toEqual(positionOf(operations));
      }),
    );
  });
});
