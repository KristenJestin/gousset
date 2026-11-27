import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { formValuesOf, operationOf, refusalField, tradeAmountOf } from "./investment-form";

const purchase = {
  kind: "purchase" as const,
  bookedOn: "2026-10-14",
  amountMinor: 33_550,
  isin: " xx0000000002 ",
  securityName: " World Index ETF ",
  quantity: "2,2",
  unitPrice: "152.05",
  feesMinor: 99,
};

describe("the operation the form sends", () => {
  test("a purchase, a fee and a withdrawal take money out: their amount is negative", () => {
    expect(operationOf(purchase).amountMinor).toBe(-33_550);
    expect(operationOf({ ...purchase, kind: "fee" }).amountMinor).toBe(-33_550);
    expect(operationOf({ ...purchase, kind: "withdrawal" }).amountMinor).toBe(-33_550);
  });

  test("a sale, a dividend and a deposit bring it in, whatever sign was typed", () => {
    for (const kind of ["sale", "dividend", "deposit"] as const) {
      expect(operationOf({ ...purchase, kind, amountMinor: -412 }).amountMinor, kind).toBe(412);
    }
  });

  test("a purchase keeps its security, its quantity and price as typed, and its fees", () => {
    expect(operationOf(purchase)).toEqual({
      kind: "purchase",
      bookedOn: "2026-10-14",
      amountMinor: -33_550,
      isin: "xx0000000002",
      securityName: "World Index ETF",
      quantity: "2,2",
      unitPrice: "152.05",
      feesMinor: 99,
    });
  });

  test("each kind sends only the fields it takes", () => {
    expect(operationOf({ ...purchase, kind: "deposit" })).toMatchObject({
      isin: null,
      securityName: null,
      quantity: null,
      unitPrice: null,
      feesMinor: 0,
    });
    expect(operationOf({ ...purchase, kind: "dividend" })).toMatchObject({
      isin: "xx0000000002",
      securityName: null,
      quantity: null,
      unitPrice: null,
      feesMinor: 99,
    });
    expect(operationOf({ ...purchase, kind: "fee", isin: "  " })).toMatchObject({
      isin: null,
      feesMinor: 0,
    });
  });

  test("an empty amount is sent as zero, for the server to refuse in words", () => {
    expect(operationOf({ ...purchase, amountMinor: null, feesMinor: null })).toMatchObject({
      amountMinor: 0,
      feesMinor: 0,
    });
  });
});

describe("an operation read back into the form", () => {
  test("its amount without its sign, its security and its quantities", () => {
    expect(
      formValuesOf({
        kind: "purchase",
        bookedOn: "2026-10-14",
        amount: { minor: -33_550, currency: "EUR" },
        fees: { minor: 99, currency: "EUR" },
        quantity: "2.2",
        unitPrice: { value: "152.05", currency: "EUR" },
        security: { id: "s", isin: "XX0000000002", name: "World Index ETF", currency: "EUR" },
      }),
    ).toEqual({
      ...purchase,
      isin: "XX0000000002",
      securityName: "World Index ETF",
      quantity: "2.2",
    });
  });
});

/** `hundredths` / 100 as typed, with a comma or a point. */
const written = (hundredths: bigint, comma: boolean) => {
  const digits = hundredths.toString().padStart(3, "0");

  return `${digits.slice(0, -2)}${comma ? "," : "."}${digits.slice(-2)}`;
};

describe("the amount a trade's quantity, price and fees give", () => {
  const trade = { kind: "purchase" as const, quantity: "2,2", unitPrice: "152.05", feesMinor: 99 };

  test("a purchase adds its fees, a sale takes them off", () => {
    // 2.2 × 152.05 = 334.51
    expect(tradeAmountOf(trade, "EUR")).toBe(33_550);
    expect(tradeAmountOf({ ...trade, kind: "sale" }, "EUR")).toBe(33_352);
    expect(tradeAmountOf({ ...trade, feesMinor: null }, "EUR")).toBe(33_451);
  });

  test("a fractional quantity, rounded once to the currency's minor units", () => {
    // 0.0347 × 112.4519 = 3.90208093: 3.90; in yen, 4; in dinars, 3.902.
    const fund = { ...trade, quantity: "0.0347", unitPrice: "112,4519", feesMinor: null };

    expect(tradeAmountOf(fund, "EUR")).toBe(390);
    expect(tradeAmountOf(fund, "JPY")).toBe(4);
    expect(tradeAmountOf(fund, "KWD")).toBe(3902);
  });

  test("a half is rounded away from zero", () => {
    // 3 × 0.005 = 0.015, 1 × 0.125 = 0.125, 1 × 2.5 yen = 2.5
    expect(
      tradeAmountOf({ ...trade, quantity: "3", unitPrice: "0.005", feesMinor: 0 }, "EUR"),
    ).toBe(2);
    expect(
      tradeAmountOf({ ...trade, quantity: "1", unitPrice: "0.125", feesMinor: 0 }, "EUR"),
    ).toBe(13);
    expect(tradeAmountOf({ ...trade, quantity: "1", unitPrice: "2.5", feesMinor: 0 }, "JPY")).toBe(
      3,
    );
    expect(
      tradeAmountOf({ ...trade, quantity: "1", unitPrice: "0.004", feesMinor: 0 }, "EUR"),
    ).toBe(0);
  });

  test("no prefill while the quantity or the price is empty or not a number", () => {
    for (const quantity of ["", " ", "abc", "1,2,3", "-1", "1e3", "0", "0,000"]) {
      expect(tradeAmountOf({ ...trade, quantity }, "EUR"), JSON.stringify(quantity)).toBeNull();
    }

    for (const unitPrice of ["", "12.", "€12", "1 000"]) {
      expect(tradeAmountOf({ ...trade, unitPrice }, "EUR"), JSON.stringify(unitPrice)).toBeNull();
    }
  });

  test("no prefill for a sale whose fees take more than it brought, nor for another kind", () => {
    expect(
      tradeAmountOf({ kind: "sale", quantity: "1", unitPrice: "1", feesMinor: 101 }, "EUR"),
    ).toBeNull();

    for (const kind of ["deposit", "withdrawal", "dividend", "fee"] as const) {
      expect(tradeAmountOf({ ...trade, kind }, "EUR"), kind).toBeNull();
    }
  });

  const hundredths = fc.bigInt({ min: 1n, max: 10n ** 8n });
  const fees = fc.integer({ min: 0, max: 1_000_000 });

  test("exact for any quantity and price in hundredths, as a long multiplication gives it", () => {
    fc.assert(
      fc.property(hundredths, hundredths, fees, fc.boolean(), (quantity, price, fee, comma) => {
        // Cents are (q × p) / 100 in ten-thousandths: rounded half up, every value being positive.
        const product = quantity * price;
        const cents = Number(product / 100n + (product % 100n >= 50n ? 1n : 0n));
        const typed = { quantity: written(quantity, comma), unitPrice: written(price, !comma) };

        expect(tradeAmountOf({ kind: "purchase", ...typed, feesMinor: fee }, "EUR")).toBe(
          cents + fee,
        );
        expect(tradeAmountOf({ kind: "sale", ...typed, feesMinor: fee }, "EUR")).toBe(
          cents >= fee ? cents - fee : null,
        );
      }),
    );
  });
});

describe("where a refusal is said", () => {
  test("under the field at fault, or under the form", () => {
    expect(refusalField({ code: "INVALID_ISIN" }, purchase)).toBe("isin");
    expect(refusalField({ code: "SECURITY_REQUIRED" }, purchase)).toBe("isin");
    expect(refusalField({ code: "AMOUNT" }, purchase)).toBe("amount");
    expect(refusalField({ code: "SIGN" }, purchase)).toBe("amount");
    expect(refusalField({ code: "FEES" }, purchase)).toBe("fees");
    expect(refusalField({ code: "DAY" }, purchase)).toBe("bookedOn");
    expect(refusalField({ code: "QUANTITY_REQUIRED" }, { ...purchase, quantity: "" })).toBe(
      "quantity",
    );
    expect(refusalField({ code: "QUANTITY_REQUIRED" }, { ...purchase, unitPrice: "" })).toBe(
      "unitPrice",
    );
    expect(refusalField({ code: "OPERATION_NOT_FOUND" }, purchase)).toBe("form");
  });

  test("an invalid quantity under the field that holds the text refused", () => {
    expect(refusalField({ code: "INVALID_QUANTITY", text: "2,2" }, purchase)).toBe("quantity");
    expect(refusalField({ code: "INVALID_QUANTITY", text: "152.05" }, purchase)).toBe("unitPrice");
  });
});
