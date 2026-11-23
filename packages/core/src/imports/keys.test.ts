import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { dedupKeys, keysTellApart, labelSimilarity, nearDuplicates } from "./keys";
import type { ExistingLine, KeyedLine } from "./keys";

const coffee: KeyedLine = {
  bookedOn: "2026-10-03",
  amountMinor: -250,
  label: "CB CAFE DU PORT 02/10",
  bankId: null,
};

describe("dedup keys", () => {
  test("OFX, QFX and CAMT.053 trust the bank's id, which makes it unique", () => {
    for (const format of ["ofx", "qfx", "camt053"] as const) {
      expect(dedupKeys(format, [{ ...coffee, bankId: "20261003-000184" }])).toEqual([
        "bank:20261003-000184",
      ]);
    }
  });

  test("QIF's N, MT940's and CSV's references do not count: the content decides", () => {
    for (const format of ["qif", "mt940", "csv"] as const) {
      const [key] = dedupKeys(format, [{ ...coffee, bankId: "NONREF" }]);

      expect(key).toMatch(/^content:[\da-f]{64}#1$/);
    }
  });

  test("a line whose format counts but whose id is missing gets the content key", () => {
    const [key] = dedupKeys("camt053", [coffee]);

    expect(key).toMatch(/^content:[\da-f]{64}#1$/);
  });

  test("identical lines of one day are kept: two coffees are #1 and #2", () => {
    const [first, second] = dedupKeys("csv", [coffee, coffee]);

    expect(first?.replace(/#1$/, "")).toBe(second?.replace(/#2$/, ""));
    expect(first).toMatch(/#1$/);
    expect(second).toMatch(/#2$/);
  });

  test("the same lines give the same keys in another file, spaces around the label aside", () => {
    const once = dedupKeys("qif", [coffee, { ...coffee, amountMinor: -300 }, coffee]);

    const again = dedupKeys("csv", [
      { ...coffee, label: "  CB CAFE  DU PORT 02/10 " },
      { ...coffee, amountMinor: -300 },
      coffee,
    ]);

    expect(again).toEqual(once);
  });

  test("a day, an amount or a label that differs gives another key", () => {
    const [base] = dedupKeys("csv", [coffee]);

    for (const other of [
      { ...coffee, bookedOn: "2026-10-04" },
      { ...coffee, amountMinor: -251 },
      { ...coffee, label: "CB CAFE DU PORT 03/10" },
    ]) {
      expect(dedupKeys("csv", [other])[0]).not.toBe(base);
    }
  });

  test("every line of a file gets a key no other line of the file has", () => {
    const line = fc.record({
      bookedOn: fc.constantFrom("2026-10-01", "2026-10-02"),
      amountMinor: fc.integer({ min: -3, max: 3 }),
      label: fc.constantFrom("A", "B", " A "),
      bankId: fc.constant(null),
    });

    fc.assert(
      fc.property(fc.array(line, { maxLength: 30 }), (lines) => {
        const keys = dedupKeys("csv", lines);

        expect(new Set(keys).size).toBe(lines.length);
      }),
    );
  });
});

describe("keys that already tell two lines apart", () => {
  const [one, two] = dedupKeys("csv", [coffee, coffee]);
  const [other] = dedupKeys("csv", [{ ...coffee, label: "CAFE DU PORT" }]);

  test("two bank ids that differ: the bank says they are two lines", () => {
    expect(keysTellApart("bank:1", "bank:2")).toBe(true);
  });

  test("the second coffee of the day, which the content key counts on purpose", () => {
    expect(keysTellApart(one ?? "", two ?? "")).toBe(true);
  });

  test("not a bank id against a content key, nor two content keys whose labels differ", () => {
    expect(keysTellApart("bank:1", one ?? "")).toBe(false);
    expect(keysTellApart(one ?? "", other ?? "")).toBe(false);
  });

  test("not a line entered by hand, which has no key", () => {
    expect(keysTellApart(null, one ?? "")).toBe(false);
  });
});

describe("label similarity", () => {
  test("the same payment read from two formats looks alike", () => {
    expect(labelSimilarity("CB GREENMARKET 2110 RIVERTON", "GREENMARKET RIVERTON")).toBeGreaterThan(
      0.5,
    );
  });

  test("two different merchants do not", () => {
    expect(labelSimilarity("CB LE FOURNIL DES TILLEULS", "PRLV SEPA STREAMFLIX")).toBeLessThan(0.1);
  });

  test("is symmetric, between 0 and 1, and 1 for a label against itself", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const similarity = labelSimilarity(a, b);

        expect(similarity).toBeGreaterThanOrEqual(0);
        expect(similarity).toBeLessThanOrEqual(1);
        expect(labelSimilarity(b, a)).toBe(similarity);
        expect(labelSimilarity(a, a)).toBe(1);
      }),
    );
  });
});

describe("near duplicates", () => {
  const known: ExistingLine = {
    id: "known",
    bookedOn: "2026-10-21",
    amountMinor: -2800,
    label: "CB GREENMARKET 2110 RIVERTON",
    dedupKey: "bank:FIT-1",
  };

  const [csvKey = ""] = dedupKeys("csv", [
    { bookedOn: "2026-10-22", amountMinor: -2800, label: "GREENMARKET RIVERTON", bankId: null },
  ]);

  const read = {
    bookedOn: "2026-10-22",
    amountMinor: -2800,
    label: "GREENMARKET RIVERTON",
    dedupKey: csvKey,
  };

  test("the same payment read from a CSV after an OFX is held against the OFX line", () => {
    expect(nearDuplicates([read], [known])).toEqual(new Map([[0, "known"]]));
  });

  test("a line entered by hand is matched too", () => {
    expect(nearDuplicates([read], [{ ...known, dedupKey: null }])).toEqual(new Map([[0, "known"]]));
  });

  test("another amount, a date too far or a label unlike it is no near duplicate", () => {
    for (const other of [
      { ...read, amountMinor: -2801 },
      { ...read, bookedOn: "2026-10-30" },
      { ...read, label: "PRLV SEPA STREAMFLIX" },
    ]) {
      expect(nearDuplicates([other], [known]).size).toBe(0);
    }
  });

  test("two bank ids that differ are never near duplicates", () => {
    expect(nearDuplicates([{ ...read, dedupKey: "bank:FIT-2" }], [known]).size).toBe(0);
  });

  test("the second coffee of a day is not held against the first", () => {
    const [first = "", second = ""] = dedupKeys("csv", [coffee, coffee]);

    const existing = [{ ...coffee, id: "first", dedupKey: first }];

    expect(nearDuplicates([{ ...coffee, dedupKey: second }], existing).size).toBe(0);
  });

  test("a known line is the near duplicate of one read line at most", () => {
    const twice = [read, { ...read, dedupKey: `${csvKey.slice(0, -2)}#2` }];

    expect(nearDuplicates(twice, [known])).toEqual(new Map([[0, "known"]]));
  });

  test("the closest known line is taken when several fit", () => {
    const further = { ...known, id: "further", bookedOn: "2026-10-19" };

    expect(nearDuplicates([read], [further, known])).toEqual(new Map([[0, "known"]]));
  });
});
