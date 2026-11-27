import { Result } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { InvalidIsin, InvalidQuantity, OperationRefused } from "./errors";
import { MAX_SECURITY_NAME, checkOperation } from "./operation-input";
import type { OperationInput } from "./operation-input";

// What an operation entered by hand, corrected, or read from a broker's file must hold together
// (docs/data-model.md, v0.6). Every amount, name and ISIN here is invented.

/** An invented ISIN with its check digit. */
const WORLD = "XX0000000002";

const purchase: OperationInput = {
  kind: "purchase",
  bookedOn: "2026-10-14",
  valueOn: "2026-10-16",
  amountMinor: -33_599,
  isin: WORLD,
  securityName: "World Index ETF",
  securityCurrency: null,
  quantity: "2,9791",
  unitPrice: "112.4519",
  feesMinor: 99,
  label: "BUY WORLD INDEX ETF",
};

const refused = (reason: OperationRefused["reason"]) =>
  Result.fail(new OperationRefused({ reason }));

describe("an operation", () => {
  test("is kept with its quantity and unit price written as Postgres writes them", () => {
    expect(checkOperation(purchase)).toEqual(
      Result.succeed({
        kind: "purchase",
        bookedOn: "2026-10-14",
        valueOn: "2026-10-16",
        amountMinor: -33_599,
        security: { isin: WORLD, name: "World Index ETF", currency: null },
        quantity: "2.9791",
        unitPrice: "112.4519",
        feesMinor: 99,
        label: "BUY WORLD INDEX ETF",
      }),
    );
  });

  test("takes money out by a purchase, a fee and a withdrawal, and brings it in otherwise", () => {
    const sign = (kind: OperationInput["kind"], amountMinor: number) => {
      const trade = kind === "purchase" || kind === "sale";
      const named = trade || kind === "dividend";

      return Result.isSuccess(
        checkOperation({
          ...purchase,
          kind,
          amountMinor,
          isin: named ? WORLD : null,
          quantity: trade ? "1" : null,
          unitPrice: trade ? "100" : null,
        }),
      );
    };

    for (const kind of ["purchase", "fee", "withdrawal"] as const) {
      expect(sign(kind, -100), kind).toBe(true);
      expect(sign(kind, 100), kind).toBe(false);
    }

    for (const kind of ["sale", "dividend", "deposit"] as const) {
      expect(sign(kind, 100), kind).toBe(true);
      expect(sign(kind, -100), kind).toBe(false);
    }

    expect(checkOperation({ ...purchase, amountMinor: 33_599 })).toEqual(refused("sign"));
    expect(checkOperation({ ...purchase, amountMinor: 0 })).toEqual(refused("amount"));
    expect(checkOperation({ ...purchase, amountMinor: -12.5 })).toEqual(refused("amount"));
  });

  test("of a purchase or a sale has a quantity and a unit price, and no other kind has them", () => {
    expect(checkOperation({ ...purchase, quantity: null })).toEqual(refused("quantity_required"));
    expect(checkOperation({ ...purchase, unitPrice: null })).toEqual(refused("quantity_required"));

    expect(
      checkOperation({ ...purchase, kind: "dividend", amountMinor: 1840, unitPrice: null }),
    ).toEqual(refused("quantity_not_allowed"));

    expect(checkOperation({ ...purchase, quantity: "0" })).toEqual(
      Result.fail(new InvalidQuantity({ text: "0" })),
    );
    expect(checkOperation({ ...purchase, unitPrice: "1.12345678901" })).toEqual(
      Result.fail(new InvalidQuantity({ text: "1.12345678901" })),
    );

    // A unit price of nothing is one: a security given away.
    expect(Result.isSuccess(checkOperation({ ...purchase, unitPrice: "0" }))).toBe(true);
  });

  test("names its security by an ISIN whose check digit holds", () => {
    expect(checkOperation({ ...purchase, isin: null })).toEqual(refused("security_required"));

    expect(checkOperation({ ...purchase, isin: "XX0000000001" })).toEqual(
      Result.fail(new InvalidIsin({ isin: "XX0000000001" })),
    );

    expect(
      checkOperation({
        ...purchase,
        kind: "deposit",
        amountMinor: 35_000,
        quantity: null,
        unitPrice: null,
      }),
    ).toEqual(refused("security_not_allowed"));

    // A fee may name its security, or none: a custody fee.
    const fee: OperationInput = {
      ...purchase,
      kind: "fee",
      amountMinor: -150,
      quantity: null,
      unitPrice: null,
    };

    expect(Result.isSuccess(checkOperation({ ...fee, isin: WORLD }))).toBe(true);
    expect(Result.isSuccess(checkOperation({ ...fee, isin: null }))).toBe(true);
  });

  test("keeps a security's name of 200 characters at most, and its currency's code", () => {
    const named = (securityName: string | null) =>
      Result.map(checkOperation({ ...purchase, securityName }), (each) => each.security?.name);

    expect(named("  World Index ETF  ")).toEqual(Result.succeed("World Index ETF"));
    expect(named("   ")).toEqual(Result.succeed(null));
    expect(named("A".repeat(250))).toEqual(Result.succeed("A".repeat(MAX_SECURITY_NAME)));

    expect(checkOperation({ ...purchase, securityCurrency: "usd" })).toEqual(refused("currency"));
    expect(
      Result.map(checkOperation({ ...purchase, securityCurrency: "USD" }), (each) => each.security),
    ).toEqual(Result.succeed({ isin: WORLD, name: "World Index ETF", currency: "USD" }));
  });

  test("is booked on a day of the calendar, settled on one when given", () => {
    expect(checkOperation({ ...purchase, bookedOn: "2026-02-30" })).toEqual(refused("day"));
    expect(checkOperation({ ...purchase, valueOn: "16/10/2026" })).toEqual(refused("day"));
    expect(Result.isSuccess(checkOperation({ ...purchase, valueOn: null }))).toBe(true);
  });

  test("pays fees of whole minor units from nothing", () => {
    expect(checkOperation({ ...purchase, feesMinor: -1 })).toEqual(refused("fees"));
    expect(checkOperation({ ...purchase, feesMinor: 0.5 })).toEqual(refused("fees"));
    expect(Result.isSuccess(checkOperation({ ...purchase, feesMinor: 0 }))).toBe(true);
  });
});
