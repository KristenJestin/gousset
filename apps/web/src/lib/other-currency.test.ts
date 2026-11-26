import { describe, expect, test } from "vite-plus/test";

import { otherCurrencyNote } from "./other-currency";

const usd = (minor: number) => ({ minor, currency: "USD" });

describe("otherCurrencyNote", () => {
  test("gives a currency's figures", () => {
    expect(
      otherCurrencyNote(
        {
          currency: "USD",
          received: usd(10_000),
          maybeRefunds: usd(0),
          spent: usd(2500),
          setAside: usd(0),
          left: usd(7500),
        },
        "en",
      ),
    ).toBe("In USD: received $100, spent $25, set aside $0, left $75");
  });

  test("says what waits there as possible refunds, out of received (#208)", () => {
    expect(
      otherCurrencyNote(
        {
          currency: "USD",
          received: usd(0),
          maybeRefunds: usd(2000),
          spent: usd(0),
          setAside: usd(0),
          left: usd(0),
        },
        "en",
      ),
    ).toBe(
      "In USD: received $0, spent $0, set aside $0, left $0; not in received: $20 that may be refunds",
    );
  });
});
