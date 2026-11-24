import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { FUND_CANDIDATES, FUND_DAYS, fundDecision, fundingCandidates } from "./funding";
import type { FundingTarget, FundingTransfer } from "./funding";

// Every amount, day and account here is invented: a works council account refunding 80.00 of a
// sports club's 120.00 fee.

const refund: FundingTransfer = {
  outKind: "benefit",
  inKind: "current",
  bookedOn: "2026-10-20",
  amountMinor: 8000,
  currency: "EUR",
  fundsEntryId: null,
};

const fee: FundingTarget = {
  id: "0199a000-0000-7000-8000-000000000001",
  kind: "expense",
  happenedOn: "2026-10-02",
  currency: "EUR",
  netMinor: 12_000,
  fundedByOthersMinor: 0,
};

describe("a transfer funding an expense", () => {
  test("a works council refund funds an expense it does not pass", () => {
    expect(fundDecision(refund, fee)).toBe("fund");
    expect(fundDecision(refund, { ...fee, netMinor: 8000 })).toBe("fund");
  });

  test("funding the expense it funds already is nothing to do", () => {
    expect(fundDecision({ ...refund, fundsEntryId: fee.id }, fee)).toBe("same");
  });

  test("refuses what is no works council refund, saying which line", () => {
    expect(fundDecision({ ...refund, outKind: "current" }, fee)).toEqual({
      reason: "not_from_benefit",
      about: "transfer",
    });
    expect(fundDecision({ ...refund, inKind: "benefit" }, fee)).toEqual({
      reason: "not_from_benefit",
      about: "transfer",
    });
    expect(
      fundDecision({ ...refund, fundsEntryId: "0199a000-0000-7000-8000-000000000002" }, fee),
    ).toEqual({ reason: "already_funding", about: "transfer" });
  });

  test("refuses what is no expense it may fund", () => {
    expect(fundDecision(refund, "none")).toEqual({ reason: "not_an_expense", about: "expense" });
    expect(fundDecision(refund, { ...fee, kind: "income" })).toEqual({
      reason: "not_an_expense",
      about: "expense",
    });
    expect(fundDecision(refund, "split")).toEqual({ reason: "split", about: "expense" });
    expect(fundDecision(refund, { ...fee, currency: "CHF" })).toEqual({
      reason: "currency",
      about: "expense",
    });
    expect(fundDecision(refund, { ...fee, happenedOn: "2026-10-21" })).toEqual({
      reason: "later",
      about: "expense",
    });
  });

  test("never funds more than the expense costs, its other fundings counted", () => {
    expect(fundDecision(refund, { ...fee, netMinor: 7999 })).toEqual({
      reason: "over_cost",
      about: "expense",
    });
    expect(fundDecision(refund, { ...fee, fundedByOthersMinor: 4001 })).toEqual({
      reason: "over_cost",
      about: "expense",
    });
    expect(fundDecision(refund, { ...fee, fundedByOthersMinor: 4000 })).toBe("fund");
  });
});

/** An expense of its own id, happened on that day, of that cost. */
const target = (index: number, happenedOn: string, netMinor = 12_000): FundingTarget => ({
  ...fee,
  id: `0199a000-0000-7000-8000-${String(index).padStart(12, "0")}`,
  happenedOn,
  netMinor,
});

describe("the expenses a transfer is offered to fund", () => {
  test("the nearest day first, within the days before it, of a cost it does not pass", () => {
    const offered = fundingCandidates(refund, [
      target(1, "2026-09-01"),
      target(2, "2026-10-19"),
      target(3, "2026-10-21"),
      target(4, "2026-07-22"),
      target(5, "2026-07-21"),
      target(6, "2026-10-10", 5000),
    ]);

    expect(offered.map((each) => each.happenedOn)).toEqual([
      "2026-10-19",
      "2026-09-01",
      "2026-07-22",
    ]);
  });

  test("none for a transfer funding an expense already, or no works council refund", () => {
    expect(fundingCandidates({ ...refund, fundsEntryId: fee.id }, [fee])).toEqual([]);
    expect(fundingCandidates({ ...refund, outKind: "savings" }, [fee])).toEqual([]);
  });

  test("never more than offered, each one it may fund", () => {
    const day = fc
      .integer({ min: -FUND_DAYS - 10, max: 5 })
      .map((shift) => new Date(Date.UTC(2026, 9, 20 + shift)).toISOString().slice(0, 10));

    const targets = fc.array(
      fc.record({
        happenedOn: day,
        netMinor: fc.integer({ min: 1, max: 30_000 }),
        fundedByOthersMinor: fc.integer({ min: 0, max: 30_000 }),
        currency: fc.constantFrom("EUR", "CHF"),
      }),
      { maxLength: 40 },
    );

    fc.assert(
      fc.property(targets, (drawn) => {
        const all = drawn.map((each, index) => ({ ...target(index, each.happenedOn), ...each }));
        const offered = fundingCandidates(refund, all);

        expect(offered.length).toBeLessThanOrEqual(FUND_CANDIDATES);

        for (const each of offered) {
          expect(fundDecision(refund, each)).toBe("fund");
        }

        expect(offered.map((each) => each.happenedOn)).toEqual(
          offered
            .map((each) => each.happenedOn)
            .toSorted()
            .toReversed(),
        );
      }),
    );
  });
});
