import {
  BROKER_ISINS,
  DEGIRO_ROWS,
  FORTUNEO_HEADER,
  FORTUNEO_ROWS,
  degiroExport,
  fortuneoExport,
  fortuneoRow,
} from "@gousset/fixture";
import { Effect, Exit, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { DEGIRO_PROFILE } from "./brokers/degiro";
import { FORTUNEO_PROFILE } from "./brokers/fortuneo";
import { csvFile, matchCsvHeader, readCsvHeader } from "./csv";
import { SHIPPED_OPERATIONS_PROFILES, SHIPPED_PROFILES } from "./csv-shipped";
import { CsvDefinition, readsOperations } from "./operations-profile";
import type { OperationKind, OperationsProfile } from "./operations-profile";
import { readOperations, testReadOperations } from "./operations";

// Invented brokers' files only (`@gousset/fixture`): the ISINs are made up, with a check digit that
// holds.
const { fund: FUND, share: SHARE, bond: BOND } = BROKER_ISINS;

const utf8 = new TextEncoder();

const fortuneoFile = fortuneoExport;

const degiroFile = degiroExport;

/** The words of Fortuneo's kind column the invented rows write, by kind. */
const WORDS = {
  deposit: "Versement espèces",
  purchase: "Achat Comptant",
  sale: "Vente Comptant",
  fee: "Droits de garde",
} as const;

const word = (kind: keyof typeof WORDS) => WORDS[kind];

const read = (bytes: Uint8Array, profile: OperationsProfile, currency = "EUR") =>
  Effect.runSync(readOperations(bytes, profile, { currency })).operations;

const failure = (bytes: Uint8Array, profile: OperationsProfile, currency = "EUR") => {
  const exit = Effect.runSyncExit(readOperations(bytes, profile, { currency }));

  if (Exit.isSuccess(exit)) {
    throw new Error("The file was read.");
  }

  return exit.cause;
};

const failed = (bytes: Uint8Array, profile: OperationsProfile, currency = "EUR") =>
  JSON.stringify(failure(bytes, profile, currency));

function operation(
  line: number,
  kind: OperationKind,
  bookedOn: string,
  amountMinor: number,
  more: Partial<{
    isin: string;
    securityName: string;
    securityCurrency: string;
    quantity: string;
    unitPrice: string;
    feesMinor: number;
    label: string;
    reference: string;
  }> = {},
) {
  return {
    line,
    kind,
    bookedOn,
    valueOn: null,
    amountMinor,
    isin: more.isin ?? null,
    securityName: more.securityName ?? null,
    securityCurrency: more.securityCurrency ?? null,
    quantity: more.quantity ?? null,
    unitPrice: more.unitPrice ?? null,
    feesMinor: more.feesMinor ?? 0,
    label: more.label ?? null,
    reference: more.reference ?? null,
    referenceUnique: false,
  };
}

describe("Fortuneo's history of operations", () => {
  test("reads each kind of operation, signed by its kind, never through a float", () => {
    expect(read(fortuneoFile(FORTUNEO_ROWS), FORTUNEO_PROFILE)).toEqual([
      operation(2, "deposit", "2026-10-05", 100_000, { label: "VIREMENT" }),
      operation(3, "purchase", "2026-10-06", -25_318, {
        isin: FUND,
        securityName: "NORTHWIND WORLD ETF",
        quantity: "10",
        unitPrice: "25.1234",
        feesMinor: 195,
        label: "NORTHWIND WORLD ETF",
      }),
      operation(4, "dividend", "2026-10-20", 357, {
        isin: FUND,
        securityName: "NORTHWIND WORLD ETF",
        feesMinor: 63,
        label: "NORTHWIND WORLD ETF",
      }),
      operation(5, "sale", "2026-11-03", 10_805, {
        isin: FUND,
        securityName: "NORTHWIND WORLD ETF",
        quantity: "4",
        unitPrice: "27.5",
        feesMinor: 195,
        label: "NORTHWIND WORLD ETF",
      }),
      operation(6, "fee", "2026-11-30", -200, { label: "DROITS DE GARDE" }),
    ]);
  });

  test("is recognised by its columns' names, wherever they stand", () => {
    const shuffled = [...FORTUNEO_HEADER].reverse();
    const rows = FORTUNEO_ROWS.map((row) => [...row].reverse());
    const bytes = fortuneoFile(rows, shuffled);

    const matched = Effect.runSync(
      matchCsvHeader(csvFile(bytes), [...SHIPPED_PROFILES, ...SHIPPED_OPERATIONS_PROFILES]),
    );

    expect(matched?.key).toBe("fortuneo-operations");
    expect(read(bytes, FORTUNEO_PROFILE)).toEqual(
      read(fortuneoFile(FORTUNEO_ROWS), FORTUNEO_PROFILE),
    );
  });

  test("its shipped header is the table's, as a profile keeps it", () => {
    const shipped = SHIPPED_OPERATIONS_PROFILES.find((each) => each.key === "fortuneo-operations");

    expect(Effect.runSync(readCsvHeader(csvFile(fortuneoFile([])), FORTUNEO_PROFILE))).toBe(
      shipped?.header,
    );
  });

  test("refuses a row whose kind the table does not name, at its line and column", () => {
    const rows = [
      FORTUNEO_ROWS[0] ?? [],
      fortuneoRow({ date: "07/10/2026", kind: "Opération sur titres", name: "X", amount: "1,00" }),
    ];

    const cause = failed(fortuneoFile(rows), FORTUNEO_PROFILE);

    expect(cause).toContain('"_tag":"InvalidField"');
    expect(cause).toContain('"line":3');
    expect(cause).toContain('"column":2');
    expect(cause).toContain('"field":"kind"');
  });

  test("refuses a purchase without its ISIN, and an ISIN whose check digit does not hold", () => {
    const without = fortuneoRow({
      date: "06/10/2026",
      kind: word("purchase"),
      name: "NORTHWIND WORLD ETF",
      quantity: "1",
      price: "10",
      amount: "-10,00",
    });

    const wrong = fortuneoRow({
      date: "06/10/2026",
      kind: word("purchase"),
      name: "NORTHWIND WORLD ETF",
      isin: "XX0000000003",
      quantity: "1",
      price: "10",
      amount: "-10,00",
    });

    expect(failed(fortuneoFile([without]), FORTUNEO_PROFILE)).toContain('"_tag":"MissingField"');
    expect(failed(fortuneoFile([without]), FORTUNEO_PROFILE)).toContain('"field":"isin"');
    expect(failed(fortuneoFile([wrong]), FORTUNEO_PROFILE)).toContain('"field":"isin"');
    expect(failed(fortuneoFile([wrong]), FORTUNEO_PROFILE)).toContain('"column":4');
  });

  test("refuses a sale whose amount says money went out, and an amount of zero", () => {
    const minus = fortuneoRow({
      date: "03/11/2026",
      kind: word("sale"),
      name: "NORTHWIND WORLD ETF",
      isin: FUND,
      quantity: "4",
      price: "27,50",
      amount: "-110,00",
    });

    const zero = fortuneoRow({ date: "30/11/2026", kind: word("fee"), name: "X", amount: "0,00" });

    expect(failed(fortuneoFile([minus]), FORTUNEO_PROFILE)).toContain('"field":"amount"');
    expect(failed(fortuneoFile([zero]), FORTUNEO_PROFILE)).toContain('"field":"amount"');
  });

  test("refuses an operation in another currency than the account's", () => {
    const dollars = fortuneoRow({
      date: "05/10/2026",
      kind: word("deposit"),
      name: "VIREMENT",
      amount: "100,00",
      currency: "USD",
    });

    const cause = failed(fortuneoFile([dollars]), FORTUNEO_PROFILE);

    expect(cause).toContain('"_tag":"UnsupportedContent"');
    expect(cause).toContain('"line":2');
  });

  test("refuses another broker's file, naming the column it lacks", () => {
    const cause = failed(utf8.encode("Date,Amount,Label\n2026-10-05,1.00,x\n"), FORTUNEO_PROFILE);

    expect(cause).toContain('"_tag":"MalformedFile"');
  });
});

describe("Degiro's Transactions.csv", () => {
  test("reads a purchase and a sale by the quantity's sign, a foreign price from its value", () => {
    expect(read(degiroFile(DEGIRO_ROWS), DEGIRO_PROFILE)).toEqual([
      operation(2, "purchase", "2026-10-06", -30_050, {
        isin: FUND,
        securityName: "NORTHWIND WORLD ETF",
        securityCurrency: "EUR",
        quantity: "3",
        unitPrice: "99.5",
        feesMinor: 200,
        label: "NORTHWIND WORLD ETF",
        reference: "a1b2c3d4-0000-4000-8000-000000000001",
      }),
      // Priced in dollars: what it was worth in euros, per unit.
      operation(3, "purchase", "2026-10-07", -27_603, {
        isin: SHARE,
        securityName: "SOUTHWIND HOLDINGS",
        securityCurrency: "USD",
        quantity: "2",
        unitPrice: "137.515",
        feesMinor: 100,
        label: "SOUTHWIND HOLDINGS",
        reference: "a1b2c3d4-0000-4000-8000-000000000002",
      }),
      operation(4, "sale", "2026-11-03", 9925, {
        isin: FUND,
        securityName: "NORTHWIND WORLD ETF",
        securityCurrency: "EUR",
        quantity: "1",
        unitPrice: "101.25",
        feesMinor: 200,
        label: "NORTHWIND WORLD ETF",
        reference: "a1b2c3d4-0000-4000-8000-000000000003",
      }),
    ]);
  });

  test("is recognised by its columns' names", () => {
    const matched = Effect.runSync(
      matchCsvHeader(csvFile(degiroFile(DEGIRO_ROWS)), [
        ...SHIPPED_PROFILES,
        ...SHIPPED_OPERATIONS_PROFILES,
      ]),
    );

    expect(matched?.key).toBe("degiro-transactions");
  });

  test("refuses a total in another currency than the account's", () => {
    const cause = failed(degiroFile(DEGIRO_ROWS), DEGIRO_PROFILE, "USD");

    expect(cause).toContain('"_tag":"UnsupportedContent"');
    expect(cause).toContain('"line":2');
  });

  test("refuses a row of no quantity, whose kind nothing tells", () => {
    const row = [...(DEGIRO_ROWS[0] ?? [])];

    row[6] = "0";

    expect(failed(degiroFile([row]), DEGIRO_PROFILE)).toContain('"field":"quantity"');
  });
});

/** A profile mapped by hand, as the import screen makes one and a user shares it. */
const HAND_MAPPED: OperationsProfile = {
  version: 1,
  reads: "operations",
  separator: ";",
  encoding: "utf8",
  skipRows: 1,
  headerRow: true,
  dateFormat: "YYYY-MM-DD",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: 2,
    kind: 3,
    isin: 4,
    securityName: 5,
    securityCurrency: null,
    quantity: 6,
    unitPrice: 7,
    fees: 8,
    amount: 9,
    label: null,
    reference: 10,
  },
  kinds: [
    { word: "Buy", kind: "purchase" },
    { word: "Sell", kind: "sale" },
    { word: "Cash in", kind: "deposit" },
    { word: "Coupon", kind: "dividend" },
  ],
  referenceUnique: true,
};

const handMapped = (rows: ReadonlyArray<string>) =>
  utf8.encode(
    `Made-up broker export\nDay;Settled;What;ISIN;Name;Units;Price;Fees;Cash;Ref\n${rows.join("\n")}\n`,
  );

describe("a profile mapped by hand", () => {
  test("reads the words of its kind column as it maps them, in any case and accents aside", () => {
    const bytes = handMapped([
      "2026-10-01;2026-10-03;CASH IN;;;;;;500,00;R-1",
      "2026-10-02;2026-10-04;buy;XX0000000028;NORTHWIND 2030 BOND;1 000,5;0,9876;1,00;-989,10;R-2",
      "2026-10-20;;Coupon;XX0000000028;NORTHWIND 2030 BOND;;;;12,00;R-3",
    ]);

    expect(read(bytes, HAND_MAPPED)).toEqual([
      {
        ...operation(3, "deposit", "2026-10-01", 50_000, { reference: "R-1" }),
        valueOn: "2026-10-03",
        referenceUnique: true,
      },
      {
        ...operation(4, "purchase", "2026-10-02", -98_910, {
          isin: BOND,
          securityName: "NORTHWIND 2030 BOND",
          quantity: "1000.5",
          unitPrice: "0.9876",
          feesMinor: 100,
          reference: "R-2",
        }),
        valueOn: "2026-10-04",
        referenceUnique: true,
      },
      {
        ...operation(5, "dividend", "2026-10-20", 1200, {
          isin: BOND,
          securityName: "NORTHWIND 2030 BOND",
          reference: "R-3",
        }),
        referenceUnique: true,
      },
    ]);
  });

  test("is the JSON a user shares, decoded as operations, a statement's as a statement's", () => {
    const decode = Schema.decodeUnknownSync(Schema.fromJsonString(CsvDefinition));
    const shared = decode(JSON.stringify(HAND_MAPPED));
    const statement = SHIPPED_PROFILES[0]?.profile;

    expect(readsOperations(shared)).toBe(true);
    expect(shared).toEqual(HAND_MAPPED);
    expect(
      statement === undefined ? undefined : readsOperations(decode(JSON.stringify(statement))),
    ).toBe(false);
  });

  test("a test read reads the top with no account, in CLF", () => {
    const bytes = handMapped(["2026-10-01;;Cash in;;;;;;500,00;R-1"]);
    const tried = Effect.runSync(testReadOperations(csvFile(bytes), HAND_MAPPED, null));

    expect(tried.operations.map((each) => each.amountMinor)).toEqual([5_000_000]);
  });
});

/** Writes an amount of minor units in `digits` decimals with a comma, thousands by spaces. */
function written(minor: number, digits: number): string {
  const negative = minor < 0;
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = text.slice(0, text.length - digits).replaceAll(/\B(?=(\d{3})+(?!\d))/g, " ");

  return `${negative ? "-" : ""}${whole},${text.slice(text.length - digits)}`;
}

describe("property: a hand-mapped file reads back what was written", () => {
  const trades = fc.record({
    kind: fc.constantFrom("Buy", "Sell"),
    amountMinor: fc.integer({ min: 1, max: 1_000_000_000_000 }),
    feesMinor: fc.integer({ min: 0, max: 1_000_000 }),
    whole: fc.bigInt({ min: 0n, max: 999_999_999_999_999n }),
    fraction: fc.stringMatching(/^\d{0,10}$/),
    isin: fc.constantFrom(FUND, SHARE, BOND),
  });

  test("amounts, fees, quantities and prices, exactly", () => {
    fc.assert(
      fc.property(fc.array(trades, { minLength: 1, maxLength: 20 }), (made) => {
        const rows = made.map((each, index) => {
          const quantity = `${each.whole.toString()}${each.fraction === "" ? "" : `,${each.fraction}`}`;

          return [
            "2026-10-01",
            "",
            each.kind,
            each.isin,
            "NAME",
            // A quantity of zero is refused: the row then buys one unit at that price.
            each.whole === 0n && /^0*$/.test(each.fraction) ? "1" : quantity,
            quantity,
            written(each.feesMinor, 2),
            written(each.kind === "Buy" ? -each.amountMinor : each.amountMinor, 2),
            `R-${String(index)}`,
          ].join(";");
        });

        const operations = read(handMapped(rows), HAND_MAPPED);

        const expected = made.map((each) => {
          const fraction = each.fraction.replace(/0+$/, "");
          const quantity = `${each.whole.toString()}${fraction === "" ? "" : `.${fraction}`}`;

          return {
            kind: each.kind === "Buy" ? "purchase" : "sale",
            amountMinor: each.kind === "Buy" ? -each.amountMinor : each.amountMinor,
            feesMinor: each.feesMinor,
            quantity: quantity === "0" ? "1" : quantity,
            unitPrice: quantity,
          };
        });

        expect(
          operations.map((each) => ({
            kind: each.kind,
            amountMinor: each.amountMinor,
            feesMinor: each.feesMinor,
            quantity: each.quantity,
            unitPrice: each.unitPrice,
          })),
        ).toEqual(expected);
      }),
    );
  });
});
