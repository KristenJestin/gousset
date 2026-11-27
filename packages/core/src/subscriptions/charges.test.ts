import { describe, expect, test } from "vite-plus/test";

import type { Look } from "../look";
import { chargesOf } from "./charges";
import type { ChargeMerchant, ChargePart } from "./charges";
import { detectSubscriptions } from "./detection";

// Which expenses subscriptions are detected from (#34), on made-up shops: one charge per expense,
// of one merchant and one currency, a dismissed merchant, an intermediary and a balance's movement
// left out.

const AUTOMATIC: Look = { color: null, logo: null };

/** Streamly with a colour and a logo (#204): a charge carries its merchant's look. */
const STREAMLY_LOOK: Look = { color: "red", logo: "0123456789abcdef" };

const MERCHANTS = new Map<string, ChargeMerchant>([
  ["streamly", { name: "Streamly", intermediary: false, dismissed: false, look: STREAMLY_LOOK }],
  ["fitclub", { name: "Fitclub", intermediary: false, dismissed: true, look: AUTOMATIC }],
  ["paypal", { name: "PayPal", intermediary: true, dismissed: false, look: AUTOMATIC }],
  ["pixelplay", { name: "Pixelplay", intermediary: false, dismissed: false, look: AUTOMATIC }],
]);

const ALIASES = new Map([
  ["STREAMLY", "streamly"],
  ["FITCLUB", "fitclub"],
  ["PAYPAL", "paypal"],
]);

function part(entryId: string, label: string, change: Partial<ChargePart> = {}): ChargePart {
  return {
    entryId,
    lineId: `line-${entryId}`,
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
        look: STREAMLY_LOOK,
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

  test("a line split into shares of one merchant is one charge, a monthly subscription at its total", () => {
    const parts = ["2026-01-08", "2026-02-08", "2026-03-08"].flatMap((happenedOn, month) => [
      part(`share-b-${month}`, "CB STREAMLY", {
        lineId: `line-${month}`,
        happenedOn,
        amountMinor: 999,
      }),
      part(`share-a-${month}`, "CB STREAMLY", {
        lineId: `line-${month}`,
        happenedOn,
        amountMinor: 2000,
      }),
    ]);

    const charges = chargesOf(parts, ALIASES, MERCHANTS);

    expect(charges.map((each) => [each.id, each.day, each.amountMinor])).toEqual([
      ["share-a-0", "2026-01-08", 2999],
      ["share-a-1", "2026-02-08", 2999],
      ["share-a-2", "2026-03-08", 2999],
    ]);

    const found = detectSubscriptions(charges, "2026-03-10");

    expect(found.map((each) => [each.merchant, each.cadence, each.usualMinor])).toEqual([
      ["Streamly", "monthly", 2999],
    ]);
  });

  test("shares of one line keep the earliest day, and other merchants' shares apart", () => {
    const charges = chargesOf(
      [
        part("late", "CB STREAMLY", { lineId: "line", happenedOn: "2026-11-09", amountMinor: 500 }),
        part("early", "CB STREAMLY", {
          lineId: "line",
          happenedOn: "2026-11-07",
          amountMinor: 400,
        }),
        part("other", "CB STREAMLY", { lineId: "line", entryMerchantId: "pixelplay" }),
      ],
      ALIASES,
      MERCHANTS,
    );

    expect(charges.map((each) => [each.id, each.merchant, each.day, each.amountMinor])).toEqual([
      ["early", "Streamly", "2026-11-07", 900],
      ["other", "Pixelplay", "2026-11-08", 949],
    ]);
  });
});
