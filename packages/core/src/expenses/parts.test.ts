import fc from "fast-check";
import { Result } from "effect";
import { describe, expect, test } from "vite-plus/test";

import {
  MAX_SHARES,
  PROPOSALS_SHOWN,
  REFUND_DAYS,
  minorOfDecimal,
  netOf,
  refundProposals,
  roleOf,
  sharesOf,
} from "./parts";
import type { ProposalLine } from "./parts";

// Every amount, label and account here is invented.

describe("an expense's net cost", () => {
  test("a 75 expense paid 25 + 50 on two accounts counts 75 once", () => {
    expect(
      netOf([
        { role: "payment", amountMinor: 2500 },
        { role: "payment", amountMinor: 5000 },
      ]),
    ).toBe(7500);
  });

  test("a refund of 20 makes it 55", () => {
    expect(
      netOf([
        { role: "payment", amountMinor: 2500 },
        { role: "payment", amountMinor: 5000 },
        { role: "refund", amountMinor: 2000 },
      ]),
    ).toBe(5500);
  });

  test("is its payments less its refunds, in any order", () => {
    const part = fc.record({
      role: fc.constantFrom("payment" as const, "refund" as const),
      amountMinor: fc.integer({ min: 1, max: 1_000_000_000 }),
    });

    fc.assert(
      fc.property(fc.array(part, { maxLength: 30 }), (parts) => {
        const paid = parts.reduce(
          (sum, each) => sum + (each.role === "payment" ? each.amountMinor : 0),
          0,
        );

        const refunded = parts.reduce(
          (sum, each) => sum + (each.role === "refund" ? each.amountMinor : 0),
          0,
        );

        expect(netOf(parts)).toBe(paid - refunded);
        expect(netOf(parts.toReversed())).toBe(netOf(parts));
      }),
    );
  });
});

describe("a part's role", () => {
  test("money out pays an expense and refunds an income; money in the other way round", () => {
    expect(roleOf("expense", -2500)).toBe("payment");
    expect(roleOf("expense", 2000)).toBe("refund");
    expect(roleOf("income", 300_000)).toBe("payment");
    expect(roleOf("income", -1500)).toBe("refund");
  });
});

describe("an amount typed in major units", () => {
  test("reads a decimal in the currency's minor units, either separator", () => {
    expect(minorOfDecimal("12.5", 2)).toBe(1250);
    expect(minorOfDecimal("12,50", 2)).toBe(1250);
    expect(minorOfDecimal(" 40 ", 2)).toBe(4000);
    expect(minorOfDecimal("1500", 0)).toBe(1500);
    expect(minorOfDecimal("1.234", 3)).toBe(1234);
  });

  test("refuses what is no positive amount of the currency", () => {
    for (const [text, digits] of [
      ["", 2],
      ["-12", 2],
      ["+12", 2],
      ["12.345", 2],
      ["12.5", 0],
      ["twelve", 2],
      ["1e3", 2],
      ["123456789012", 2],
    ] as const) {
      expect(minorOfDecimal(text, digits), text).toBeUndefined();
    }
  });
});

describe("a line split across categories", () => {
  test("a split line sums to the line", () => {
    const shares = sharesOf(-7500, 2, ["30", "45.00"]);

    expect(shares).toEqual(Result.succeed([3000, 4500]));
  });

  test("shares that do not sum to the line are refused", () => {
    expect(sharesOf(-7500, 2, ["30", "40"])).toEqual(Result.fail({ reason: "sum" }));
    expect(sharesOf(-7500, 2, ["30", "50"])).toEqual(Result.fail({ reason: "sum" }));
  });

  test("a share of nothing, of no amount or of more decimals than the currency is refused", () => {
    expect(sharesOf(-7500, 2, ["75", "0"])).toEqual(Result.fail({ reason: "amount", index: 1 }));
    expect(sharesOf(-7500, 2, ["x", "75"])).toEqual(Result.fail({ reason: "amount", index: 0 }));
    expect(sharesOf(-7500, 2, ["74.995", "0.005"])).toEqual(
      Result.fail({ reason: "amount", index: 0 }),
    );
  });

  test(`no share, or more than ${MAX_SHARES}, is refused`, () => {
    expect(sharesOf(-7500, 2, [])).toEqual(Result.fail({ reason: "count" }));

    expect(
      sharesOf(
        -2100,
        2,
        Array.from({ length: MAX_SHARES + 1 }, () => "1"),
      ),
    ).toEqual(Result.fail({ reason: "count" }));
  });

  test("any cut of a line into positive shares sums to the line, and nothing else does", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10_000_000 }),
        fc.boolean(),
        fc.integer({ min: 1, max: MAX_SHARES - 1 }),
        fc.integer({ min: -3, max: 3 }),
        (whole, out, cuts, drift) => {
          // Cut points strictly inside the line give shares of at least one minor unit each.
          const points = [
            ...new Set(
              Array.from({ length: Math.min(cuts, whole - 1) }, (_, index) =>
                Math.max(1, Math.floor((whole * (index + 1)) / (cuts + 1))),
              ),
            ),
          ].toSorted((a, b) => a - b);

          const bounds = [0, ...points, whole];
          const amounts = bounds.slice(1).map((bound, index) => bound - (bounds[index] ?? 0));
          const typed = amounts.map((minor) => (minor / 100).toFixed(2));
          const line = out ? -whole : whole;

          expect(sharesOf(line, 2, typed)).toEqual(Result.succeed(amounts));

          const last = amounts.at(-1) ?? 0;

          if (drift !== 0 && last + drift > 0) {
            const drifted = [...typed.slice(0, -1), ((last + drift) / 100).toFixed(2)];

            expect(sharesOf(line, 2, drifted)).toEqual(Result.fail({ reason: "sum" }));
          }
        },
      ),
    );
  });
});

describe("a cancellation proposed as a refund", () => {
  const purchase: ProposalLine = {
    id: "purchase",
    currency: "EUR",
    bookedOn: "2026-10-12",
    amountMinor: -5600,
    merchantId: "corner-bistro",
    key: "CORNER BISTRO",
    netMinor: 5600,
  };

  const cancelled: ProposalLine = {
    id: "cancelled",
    currency: "EUR",
    bookedOn: "2026-10-15",
    amountMinor: 5600,
    merchantId: "corner-bistro",
    key: "CORNER BISTRO",
    netMinor: 5600,
  };

  test("a later line of the opposite sign, the same merchant and amount, is proposed", () => {
    expect(refundProposals(cancelled, [purchase])).toEqual([purchase]);
  });

  test("a smaller amount is proposed: a part returned", () => {
    expect(refundProposals({ ...cancelled, amountMinor: 2000 }, [purchase])).toEqual([purchase]);
  });

  test("the same merchant read from two labels that differ is proposed", () => {
    const returned = { ...cancelled, merchantId: null, key: "AVOIR CORNER BISTRO" };

    expect(refundProposals(returned, [purchase])).toEqual([purchase]);
  });

  test("another merchant, a bigger amount, an earlier day, another currency or the same sign are not", () => {
    for (const other of [
      { ...purchase, merchantId: "harbor-books", key: "HARBOR BOOKS" },
      { ...purchase, amountMinor: -5000, netMinor: 5000 },
      { ...purchase, netMinor: 3000 },
      { ...purchase, bookedOn: "2026-10-16" },
      { ...purchase, currency: "USD" },
      { ...purchase, amountMinor: 5600 },
      { ...purchase, id: "cancelled" },
    ]) {
      expect(refundProposals(cancelled, [other]), JSON.stringify(other)).toEqual([]);
    }
  });

  test(`a purchase more than ${REFUND_DAYS} days before is not`, () => {
    expect(refundProposals(cancelled, [{ ...purchase, bookedOn: "2026-08-15" }])).toEqual([]);
    expect(refundProposals(cancelled, [{ ...purchase, bookedOn: "2026-08-16" }])).toHaveLength(1);
  });

  test("a merchant's key of a few letters names no merchant", () => {
    const short = { ...purchase, merchantId: null, key: "BAR" };

    expect(refundProposals({ ...cancelled, merchantId: null, key: "BAR SOLEIL" }, [short])).toEqual(
      [],
    );
  });

  test(`the exact amount first, then the nearest day; ${PROPOSALS_SHOWN} at most`, () => {
    const older = { ...purchase, id: "older", bookedOn: "2026-10-01" };
    const bigger = { ...purchase, id: "bigger", amountMinor: -8000, netMinor: 8000 };
    const nearest = { ...purchase, id: "nearest", bookedOn: "2026-10-14" };
    const oldest = { ...purchase, id: "oldest", bookedOn: "2026-09-20" };

    expect(
      refundProposals(cancelled, [older, bigger, oldest, nearest, purchase]).map((each) => each.id),
    ).toEqual(["nearest", "purchase", "older"]);
  });
});
