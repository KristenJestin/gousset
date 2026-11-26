import { describe, expect, test } from "vite-plus/test";

import type { LineCategory } from "./category-store";
import type { RefundProposal } from "./expenses/expenses";
import { proposalKey, proposalOf } from "./review-proposal";
import type { ProposalFacts } from "./review-proposal";
import type { TransferSide } from "./transfers/transfers";

// The proposal the lines to review get (#35), by priority: a held line's duplicate, a transfer's
// first candidate, a refund's first expense, then the category the line is in. Made-up data.

const groceries: LineCategory = {
  id: "c-groceries",
  name: "Groceries",
  parentName: null,
  kind: "expense",
};

const account = { id: "a-current", name: "Current account", institution: "Riverside Bank" };

const side = (id: string): TransferSide => ({
  id,
  bookedOn: "2026-11-03",
  label: "TRANSFER TO LIVRET",
  amount: { minor: 5000, currency: "EUR" },
  account,
  madeByApp: false,
});

const refund = (lineId: string): RefundProposal => ({
  line: {
    lineId,
    bookedOn: "2026-10-28",
    label: "CB CORNER SHOP",
    account,
    amount: { minor: 3000, currency: "EUR" },
  },
  category: groceries,
  net: { minor: 3000, currency: "EUR" },
});

const original = {
  id: "l-original",
  bookedOn: "2026-11-02",
  label: "CB CORNER CAFE",
  amount: { minor: -2380, currency: "EUR" },
};

/** A counted line going out, in Groceries by default, with nothing else to propose. */
const facts = (change: Partial<ProposalFacts> = {}): ProposalFacts => ({
  held: false,
  duplicateOf: null,
  candidates: [],
  refunds: [],
  amountMinor: -3000,
  category: groceries,
  merchant: null,
  ...change,
});

describe("proposalOf", () => {
  test("a counted line still classified by default keeps its category, with its merchant", () => {
    const merchant = { id: "m-corner", name: "Corner Shop" };

    expect(proposalOf(facts({ merchant }))).toEqual({
      kind: "category",
      category: groceries,
      merchant,
    });
  });

  test("a held line is discarded as a repeat of the line it looks like, whatever else it has", () => {
    expect(
      proposalOf(
        facts({
          held: true,
          duplicateOf: original,
          candidates: [side("l-a")],
          refunds: [refund("l-b")],
        }),
      ),
    ).toEqual({ kind: "duplicate", of: original });
  });

  test("a line with several candidates is paired with the first, the others counted", () => {
    expect(
      proposalOf(facts({ candidates: [side("l-a"), side("l-b"), side("l-c")], amountMinor: 5000 })),
    ).toEqual({ kind: "transfer", candidate: side("l-a"), others: 2 });
  });

  test("a transfer comes before a refund", () => {
    expect(
      proposalOf(
        facts({
          candidates: [side("l-a"), side("l-b")],
          refunds: [refund("l-c")],
          amountMinor: 3000,
        }),
      ).kind,
    ).toBe("transfer");
  });

  test("a line coming back with refund proposals is linked to the first one", () => {
    expect(
      proposalOf(facts({ refunds: [refund("l-a"), refund("l-b")], amountMinor: 3000 })),
    ).toEqual({ kind: "refund", expense: refund("l-a"), others: 1 });
  });

  test("a line going out is never proposed as a refund", () => {
    expect(proposalOf(facts({ refunds: [refund("l-a")], amountMinor: -3000 })).kind).toBe(
      "category",
    );
  });

  test("a line whose candidates are gone keeps its category", () => {
    expect(proposalOf(facts({ candidates: [] })).kind).toBe("category");
  });
});

describe("proposalKey", () => {
  test("names what accepting does: the line repeated, the candidate, the expense, the category", () => {
    expect(proposalKey(proposalOf(facts({ held: true, duplicateOf: original })))).toBe(
      "duplicate:l-original",
    );

    expect(proposalKey(proposalOf(facts({ held: true })))).toBe("duplicate");

    expect(proposalKey(proposalOf(facts({ candidates: [side("l-a"), side("l-b")] })))).toBe(
      "transfer:l-a",
    );

    expect(proposalKey(proposalOf(facts({ refunds: [refund("l-c")], amountMinor: 3000 })))).toBe(
      "refund:l-c",
    );

    expect(proposalKey(proposalOf(facts()))).toBe("category:c-groceries");
    expect(proposalKey(proposalOf(facts({ category: null })))).toBe("category");
  });

  test("a transfer and a refund naming the same line have different keys", () => {
    expect(
      proposalKey(proposalOf(facts({ candidates: [side("l-a")], amountMinor: 3000 }))),
    ).not.toBe(proposalKey(proposalOf(facts({ refunds: [refund("l-a")], amountMinor: 3000 }))));
  });

  test("a change of proposal changes the key", () => {
    expect(proposalKey(proposalOf(facts({ candidates: [side("l-a"), side("l-b")] })))).not.toBe(
      proposalKey(proposalOf(facts({ candidates: [side("l-b"), side("l-a")] }))),
    );
  });
});
