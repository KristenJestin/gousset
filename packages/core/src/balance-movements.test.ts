import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { addDays } from "./balances";
import { balanceMovements } from "./balance-movements";

/** Any amount a ledger holds, kept small enough that thousands of them add up exactly. */
const anyMinor = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

/** A day of 2026. */
const anyDay = fc.integer({ min: 0, max: 364 }).map((offset) => addDays("2026-01-01", offset));

describe("balanceMovements", () => {
  test("a balance going from 120 to 80 with a transfer of 50 in gives an expense of 90", () => {
    expect(
      balanceMovements(
        0,
        [
          { day: "2026-09-30", minor: 12_000 },
          { day: "2026-10-31", minor: 8000 },
        ],
        [{ bookedOn: "2026-10-12", amountMinor: 5000 }],
      ),
    ).toEqual([
      { day: "2026-09-30", minor: 12_000 },
      { day: "2026-10-31", minor: -9000 },
    ]);
  });

  test("the first noted balance moves from the opening balance, less every line before it", () => {
    expect(
      balanceMovements(
        2000,
        [{ day: "2026-10-31", minor: 8000 }],
        [
          { bookedOn: "2026-09-01", amountMinor: 1000 },
          { bookedOn: "2026-10-31", amountMinor: 3000 },
        ],
      ),
    ).toEqual([{ day: "2026-10-31", minor: 2000 }]);
  });

  test("a line booked on a noted balance's day is in it; one after the last is in none", () => {
    expect(
      balanceMovements(
        0,
        [
          { day: "2026-10-01", minor: 1000 },
          { day: "2026-11-01", minor: 1000 },
        ],
        [
          { bookedOn: "2026-10-01", amountMinor: 400 },
          { bookedOn: "2026-11-01", amountMinor: -300 },
          { bookedOn: "2026-11-02", amountMinor: 9999 },
        ],
      ),
    ).toEqual([
      { day: "2026-10-01", minor: 600 },
      { day: "2026-11-01", minor: 300 },
    ]);
  });

  test("no noted balance makes no movement", () => {
    expect(balanceMovements(500, [], [{ bookedOn: "2026-10-01", amountMinor: 400 }])).toEqual([]);
  });

  test("the opening balance, the lines and the movements always add up to each noted balance", () => {
    fc.assert(
      fc.property(
        anyMinor,
        fc.uniqueArray(fc.record({ day: anyDay, minor: anyMinor }), {
          selector: (noted) => noted.day,
          maxLength: 12,
        }),
        fc.array(fc.record({ bookedOn: anyDay, amountMinor: anyMinor }), { maxLength: 30 }),
        (opening, unsorted, lines) => {
          const noted = unsorted.toSorted((a, b) => a.day.localeCompare(b.day));
          const movements = balanceMovements(opening, noted, lines);

          expect(movements.map((each) => each.day)).toEqual(noted.map((each) => each.day));

          for (const balance of noted) {
            const linesUpTo = lines
              .filter((line) => line.bookedOn <= balance.day)
              .reduce((total, line) => total + line.amountMinor, 0);

            const movedUpTo = movements
              .filter((movement) => movement.day <= balance.day)
              .reduce((total, movement) => total + movement.minor, 0);

            expect(opening + linesUpTo + movedUpTo).toBe(balance.minor);
          }
        },
      ),
    );
  });
});
