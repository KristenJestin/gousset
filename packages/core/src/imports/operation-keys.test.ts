import { createHash } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import { operationDedupKeys } from "./operation-keys";
import type { KeyedOperation } from "./operation-keys";

// The dedup key of an operation read from a broker's file (docs/data-model.md, v0.6): its line's,
// `bank:` and the broker's reference when the layout makes it unique to the row, `operation:` and
// the content otherwise. Every reference, ISIN and amount here is invented.

const purchase: KeyedOperation = {
  bookedOn: "2026-10-14",
  kind: "purchase",
  isin: "XX0000000002",
  quantity: "2.9791",
  unitPrice: "112.4519",
  amountMinor: -33_599,
  reference: null,
  referenceUnique: false,
};

const content = (each: KeyedOperation) =>
  createHash("sha256")
    .update(
      [
        each.bookedOn,
        each.kind,
        each.isin ?? "",
        each.quantity ?? "",
        each.unitPrice ?? "",
        String(each.amountMinor),
      ].join("\n"),
    )
    .digest("hex");

describe("an operation's dedup key", () => {
  test("is the broker's reference when the layout makes it unique to the row", () => {
    expect(
      operationDedupKeys([{ ...purchase, reference: "ORD-20261014-0042", referenceUnique: true }]),
    ).toEqual(["bank:ORD-20261014-0042"]);
  });

  test("is its content otherwise: the day, kind, ISIN, quantity, unit price and amount", () => {
    expect(operationDedupKeys([{ ...purchase, reference: "ORD-1" }])).toEqual([
      `operation:${content(purchase)}#1`,
    ]);

    // A row with a unique reference left empty is keyed by its content too.
    expect(operationDedupKeys([{ ...purchase, reference: "", referenceUnique: true }])).toEqual([
      `operation:${content(purchase)}#1`,
    ]);

    const fee: KeyedOperation = {
      ...purchase,
      kind: "fee",
      isin: null,
      quantity: null,
      unitPrice: null,
      amountMinor: -150,
    };

    expect(operationDedupKeys([fee])).toEqual([`operation:${content(fee)}#1`]);
  });

  test("counts two identical operations of a day, which stay two", () => {
    const keys = operationDedupKeys([purchase, { ...purchase, amountMinor: -100 }, purchase]);

    expect(keys[0]).toBe(`operation:${content(purchase)}#1`);
    expect(keys[2]).toBe(`operation:${content(purchase)}#2`);
    expect(new Set(keys).size).toBe(3);
  });

  test("tells apart what any of the six changes", () => {
    const variants: ReadonlyArray<KeyedOperation> = [
      purchase,
      { ...purchase, bookedOn: "2026-10-15" },
      { ...purchase, kind: "sale", amountMinor: 33_599 },
      { ...purchase, isin: "XX0000000010" },
      { ...purchase, quantity: "2.9792" },
      { ...purchase, unitPrice: "112.452" },
      { ...purchase, amountMinor: -33_600 },
    ];

    const keys = variants.map((each) => operationDedupKeys([each])[0]);

    expect(new Set(keys).size).toBe(variants.length);
  });

  test("never meets the content key of a statement line of the same account", () => {
    for (const key of operationDedupKeys([
      purchase,
      { ...purchase, reference: "R", referenceUnique: true },
    ])) {
      expect(key.startsWith("content:")).toBe(false);
    }
  });
});
