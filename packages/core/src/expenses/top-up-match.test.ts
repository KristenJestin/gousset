import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { drainingLines, issuerKey, namesIssuer, topUpPairs } from "./top-up-match";
import type { TopUpBankLine, TopUpCardLine } from "./top-up-match";

// Every issuer, label, amount and day here is invented.

const ISSUER = "MEALPASS";

const card = (id: string, bookedOn: string, days = 3): TopUpCardLine => ({
  id,
  bookedOn,
  currency: "EUR",
  issuer: ISSUER,
  days,
});

const bank = (id: string, bookedOn: string, label = "CB MEALPASS*TOPUP"): TopUpBankLine => ({
  id,
  bookedOn,
  currency: "EUR",
  texts: [label, null, null],
});

describe("the issuer a bank line names", () => {
  test("its words run together make its key", () => {
    expect(issuerKey("Meal Pass")).toBe("MEALPASS");
    expect(issuerKey("Mëal-pass")).toBe("MEALPASS");
  });

  test("no issuer, or one too short, names nothing", () => {
    expect(issuerKey(null)).toBeNull();
    expect(issuerKey(" M ")).toBeNull();
  });

  test("a label names it as a word, or as words run together", () => {
    expect(namesIssuer(["CB MEALPASS*TOPUP 0412"], ISSUER)).toBe(true);
    expect(namesIssuer(["PAIEMENT MEAL PASS 0412"], ISSUER)).toBe(true);
    expect(namesIssuer([null, "mealpass"], ISSUER)).toBe(true);
  });

  test("a longer word, or another one, does not", () => {
    expect(namesIssuer(["CB MEALPASSAGE"], ISSUER)).toBe(false);
    expect(namesIssuer(["CB GREENMARKET"], ISSUER)).toBe(false);
    expect(namesIssuer([null], ISSUER)).toBe(false);
  });
});

describe("a card line that paid all the card could", () => {
  test("the line that empties the card", () => {
    const lines = [
      { id: "credit", bookedOn: "2026-10-01", amountMinor: 5000 },
      { id: "lunch", bookedOn: "2026-10-02", amountMinor: -2200 },
      { id: "groceries", bookedOn: "2026-10-05", amountMinor: -2800 },
    ];

    expect([...drainingLines(0, lines, null)]).toEqual(["groceries"]);
  });

  test("the line that reaches the day's cap exactly", () => {
    const lines = [
      { id: "credit", bookedOn: "2026-10-01", amountMinor: 20_000 },
      { id: "coffee", bookedOn: "2026-10-02", amountMinor: -500 },
      { id: "lunch", bookedOn: "2026-10-02", amountMinor: -2000 },
      { id: "dinner", bookedOn: "2026-10-03", amountMinor: -1800 },
    ];

    expect([...drainingLines(0, lines, 2500)]).toEqual(["lunch"]);
  });

  test("a line that leaves money and no cap reached paid nothing more", () => {
    const lines = [{ id: "lunch", bookedOn: "2026-10-02", amountMinor: -1200 }];

    expect(drainingLines(5000, lines, 2500).size).toBe(0);
  });

  test("a credit never drains the card", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 20 }), (amounts) => {
        const lines = amounts.map((amountMinor, index) => ({
          id: `credit-${index}`,
          bookedOn: "2026-10-01",
          amountMinor,
        }));

        expect(drainingLines(0, lines, 2500).size).toBe(0);
      }),
    );
  });
});

describe("a top-up matched into one expense", () => {
  test("matched on the card line's day", () => {
    expect(topUpPairs([card("meal", "2026-10-05")], [bank("rest", "2026-10-05")])).toEqual([
      { cardLineId: "meal", bankLineId: "rest" },
    ]);
  });

  test("matched within the issuer's delay", () => {
    expect(topUpPairs([card("meal", "2026-10-05", 3)], [bank("rest", "2026-10-08")])).toEqual([
      { cardLineId: "meal", bankLineId: "rest" },
    ]);
  });

  test("not matched when the moments disagree: past the delay, or before the card line", () => {
    expect(topUpPairs([card("meal", "2026-10-05", 3)], [bank("late", "2026-10-09")])).toEqual([]);
    expect(topUpPairs([card("meal", "2026-10-05", 3)], [bank("early", "2026-10-04")])).toEqual([]);
  });

  test("a delay of 0 days keeps to the same day", () => {
    expect(topUpPairs([card("meal", "2026-10-05", 0)], [bank("next", "2026-10-06")])).toEqual([]);
  });

  test("not matched when the bank line names another issuer or another currency", () => {
    expect(
      topUpPairs([card("meal", "2026-10-05")], [bank("other", "2026-10-05", "CB GREENMARKET")]),
    ).toEqual([]);
    expect(
      topUpPairs([card("meal", "2026-10-05")], [{ ...bank("usd", "2026-10-05"), currency: "USD" }]),
    ).toEqual([]);
  });

  test("two candidate top-ups are never guessed", () => {
    expect(
      topUpPairs([card("meal", "2026-10-05")], [bank("a", "2026-10-05"), bank("b", "2026-10-06")]),
    ).toEqual([]);
  });

  test("two card lines for one top-up are never guessed either", () => {
    expect(
      topUpPairs(
        [card("lunch", "2026-10-05"), card("dinner", "2026-10-06")],
        [bank("rest", "2026-10-06")],
      ),
    ).toEqual([]);
  });

  test("each pair is its lines' only candidate, whatever the order", () => {
    const days = fc
      .integer({ min: 1, max: 28 })
      .map((day) => `2026-10-${String(day).padStart(2, "0")}`);

    fc.assert(
      fc.property(fc.array(days, { maxLength: 8 }), fc.array(days, { maxLength: 8 }), (a, b) => {
        const cards = a.map((day, index) => card(`c${index}`, day));
        const banks = b.map((day, index) => bank(`b${index}`, day));
        const pairs = topUpPairs(cards, banks);
        const reversed = topUpPairs(cards.toReversed(), banks.toReversed());

        expect(new Set(reversed.map((pair) => pair.cardLineId))).toEqual(
          new Set(pairs.map((pair) => pair.cardLineId)),
        );
        expect(new Set(pairs.map((pair) => pair.bankLineId)).size).toBe(pairs.length);
      }),
    );
  });
});
