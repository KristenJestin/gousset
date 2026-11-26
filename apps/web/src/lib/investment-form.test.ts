import { describe, expect, test } from "vite-plus/test";

import { formValuesOf, operationOf, refusalField } from "./investment-form";

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
