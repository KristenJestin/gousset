import { describe, expect, test } from "vite-plus/test";

import { chargesOf } from "./charges";
import type { ChargeMerchant, ChargePart } from "./charges";

// Which expenses subscriptions are detected from (#34), on made-up shops: one charge per expense,
// of one merchant and one currency, a dismissed merchant, an intermediary and a balance's movement
// left out.

const MERCHANTS = new Map<string, ChargeMerchant>([
  ["streamly", { name: "Streamly", intermediary: false, dismissed: false }],
  ["fitclub", { name: "Fitclub", intermediary: false, dismissed: true }],
  ["paypal", { name: "PayPal", intermediary: true, dismissed: false }],
  ["pixelplay", { name: "Pixelplay", intermediary: false, dismissed: false }],
]);

const ALIASES = new Map([
  ["STREAMLY", "streamly"],
  ["FITCLUB", "fitclub"],
  ["PAYPAL", "paypal"],
]);

function part(entryId: string, label: string, change: Partial<ChargePart> = {}): ChargePart {
  return {
    entryId,
    happenedOn: "2026-11-08",
    entryMerchantId: null,
    amountMinor: 949,
    label,
    counterpartyName: null,
    source: "import",
    currency: "EUR",
    ...change,
  };
}

describe("chargesOf", () => {
  test("makes each expense one charge of its label's merchant, its payments added up", () => {
    const charges = chargesOf(
      [
        part("a", "CB STREAMLY", { amountMinor: 500 }),
        part("a", "CB STREAMLY", { amountMinor: 449 }),
      ],
      ALIASES,
      MERCHANTS,
    );

    expect(charges).toEqual([
      {
        id: "a",
        merchantId: "streamly",
        merchant: "Streamly",
        day: "2026-11-08",
        amountMinor: 949,
        currency: "EUR",
      },
    ]);
  });

  test("leaves out a dismissed merchant, a label naming none, and lines naming several", () => {
    const charges = chargesOf(
      [
        part("dismissed", "CB FITCLUB"),
        part("unknown", "CB SOMEWHERE ELSE"),
        part("several", "CB STREAMLY"),
        part("several", "CB FITCLUB"),
      ],
      ALIASES,
      MERCHANTS,
    );

    expect(charges).toEqual([]);
  });

  test("an intermediary is no one paid, unless the expense's own merchant names who was", () => {
    const charges = chargesOf(
      [
        part("through", "PAYPAL"),
        part("named", "PAYPAL", { entryMerchantId: "pixelplay" }),
        // An expense's own merchant that is an intermediary counts as none (#30).
        part("own-intermediary", "CB STREAMLY", { entryMerchantId: "paypal" }),
      ],
      ALIASES,
      MERCHANTS,
    );

    expect(charges.map((each) => [each.id, each.merchant])).toEqual([
      ["named", "Pixelplay"],
      ["own-intermediary", "Streamly"],
    ]);
  });

  test("leaves out an expense paid by a balance's movement, or in two currencies", () => {
    const charges = chargesOf(
      [
        part("balance", "", { source: "balance", entryMerchantId: "streamly" }),
        part("currencies", "CB STREAMLY"),
        part("currencies", "CB STREAMLY", { currency: "USD" }),
      ],
      ALIASES,
      MERCHANTS,
    );

    expect(charges).toEqual([]);
  });
});
