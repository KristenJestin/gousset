import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { isKnownIntermediary } from "./intermediaries";
import { MAX_KEY_LENGTH, assignMerchants, merchantKey, merchantName, nameKey } from "./labels";
import type { KnownKey } from "./labels";

// Every label, shop, town and person here is invented.
const LABELS: ReadonlyArray<readonly [string, string, string | null]> = [
  // French banks: card payments.
  ["French card, DDMM then the town", "CB GREENMARKET 2110 RIVERTON", "GREENMARKET"],
  ["French card, the date first", "CARTE 21/10/26 GREENMARKET", "GREENMARKET"],
  [
    "French card, the town with no separator stays",
    "PAIEMENT PAR CARTE GREENMARKET RIVERTON 21/10",
    "GREENMARKET RIVERTON",
  ],
  ["French card, a masked card glued to CB", "CB*4821 GREENMARKET 21/10", "GREENMARKET"],
  [
    "French card, a full masked card number",
    "ACHAT CB CORNER CAFE 21.10.26 CARTE 4974XXXXXXXX1234",
    "CORNER CAFE",
  ],
  [
    "French invoice of a card",
    "FACTURE CARTE DU 211026 CORNER CAFE RIVERTON CARTE X1234",
    "CORNER CAFE RIVERTON",
  ],
  ["French card, an article kept", "CB LE FOURNIL DES TILLEULS 02/10", "LE FOURNIL DES TILLEULS"],
  ["French card, a typographic apostrophe", "CB L’ÉPICERIE DU COIN 03/11", "L'EPICERIE DU COIN"],
  ["French card, & CIE at the end", "CB MARCHE DE LA PLACE & CIE 08/10", "MARCHE DE LA PLACE"],
  ["French card, accents", "CB PÂTISSERIE DU MARCHÉ 31/10", "PATISSERIE DU MARCHE"],
  ["French card, a store number", "CB FUELSTOP 0412 RIVERTON", "FUELSTOP"],
  ["French card, nothing to strip but CB", "CB HILLSIDE PHARMACY", "HILLSIDE PHARMACY"],
  ["French card, a date with a month name", "CB GREENMARKET 21 OCT RIVERTON", "GREENMARKET"],
  ["French card, a reference token", "CB AB12CD34E GREENMARKET", "GREENMARKET"],
  ["French card, an amount after the name", "CB CORNER CAFE 23,40 EUR RIVERTON", "CORNER CAFE"],
  ["an amount before the name", "EUR 23.40 CORNER CAFE", "CORNER CAFE"],
  ["a time between words", "CB CORNER CAFE 10:15 RIVERTON", "CORNER CAFE"],
  // French banks: direct debits.
  ["French direct debit", "PRLV SEPA STREAMFLIX ABONNEMENT", "STREAMFLIX ABONNEMENT"],
  [
    "French structured direct debit",
    "PRLV SEPA NORTHWIND ENERGIE ECH/051126 ID EMETTEUR/FR12ZZZ345678 MDT/NWE-2026-0042 REF/FAC123456 LIB:FACTURE NOVEMBRE",
    "NORTHWIND ENERGIE",
  ],
  [
    "French European direct debit, a legal form",
    "PRELEVEMENT EUROPEEN NORTHWIND ENERGIE SA",
    "NORTHWIND ENERGIE",
  ],
  ["French direct debit, ET kept", "PRLV SEPA ELEC ET GAZ EXEMPLE", "ELEC ET GAZ EXEMPLE"],
  ["French returned direct debit", "RETOUR PRLV SEPA ELEC ET GAZ EXEMPLE", "ELEC ET GAZ EXEMPLE"],
  ["French rent", "PRLV SEPA SCI DES GLYCINES LOYER", "SCI DES GLYCINES LOYER"],
  // French banks: transfers.
  [
    "French transfer received, /DE and /MOTIF",
    "VIR SEPA RECU /DE ACME CONSEIL /MOTIF SALAIRE OCTOBRE /REF 20261031",
    "ACME CONSEIL",
  ],
  [
    "French instant transfer sent, POUR:",
    "VIREMENT INSTANTANE EMIS POUR: CAMILLE EXEMPLE REF: LOYER-NOV",
    "CAMILLE EXEMPLE",
  ],
  [
    "French instant transfer, DE: and MOTIF:",
    "VIR INST DE: ACME CONSEIL MOTIF: PRIME",
    "ACME CONSEIL",
  ],
  [
    "French transfer, free text kept",
    "VIR SEPA ACME CONSEIL SALAIRE OCTOBRE",
    "ACME CONSEIL SALAIRE OCTOBRE",
  ],
  [
    "French transfer, /FRM and a legal form",
    "VIREMENT RECU /FRM ACME CONSEIL SAS /REF REM-2026-10",
    "ACME CONSEIL",
  ],
  // French banks: fees keep a key, withdrawals give none.
  ["French account fee", "FRAIS TENUE DE COMPTE", "FRAIS TENUE DE COMPTE"],
  ["French overdraft fee", "COMMISSION D'INTERVENTION 21/10", "COMMISSION D'INTERVENTION"],
  ["French card fee", "COTISATION CARTE VISA CLASSIC", "COTISATION CARTE VISA CLASSIC"],
  ["French withdrawal, DAB", "RETRAIT DAB 21/10 RIVERTON", null],
  ["French withdrawal, GAB", "RETRAIT GAB RIVERTON 21/10/26 CARTE X1234", null],
  // English and UK.
  ["UK card payment, ON and a date", "CARD PAYMENT TO CORNER CAFE ON 21-10-2026", "CORNER CAFE"],
  ["UK, a country code at the end", "CORNER CAFE RIVERTON GB", "CORNER CAFE RIVERTON"],
  ["UK contactless", "CONTACTLESS CORNER CAFE RIVERTON", "CORNER CAFE RIVERTON"],
  ["UK direct debit", "DIRECT DEBIT TO NORTHWIND ENERGY LTD", "NORTHWIND ENERGY"],
  ["UK point of sale, 21OCT", "POS 21OCT GREENMARKET RIVERTON GB", "GREENMARKET RIVERTON"],
  [
    "UK faster payment, LIMITED and REF",
    "FASTER PAYMENT TO ACME WIDGETS LIMITED REF 4471",
    "ACME WIDGETS",
  ],
  ["UK Visa debit", "VISA DEBIT GREENMARKET 21/10 RIVERTON", "GREENMARKET"],
  ["English transfer", "SEPA TRF ACME CONSULTING SALARY", "ACME CONSULTING SALARY"],
  ["UK standing order", "STANDING ORDER CAMILLE EXEMPLE", "CAMILLE EXEMPLE"],
  ["cash withdrawal", "CASH WITHDRAWAL RIVERTON 21OCT", null],
  ["ATM withdrawal", "ATM WITHDRAWAL - RIVERTON", null],
  // United States.
  ["US Square-like processor and a state", "SQ *CORNER CAFE RIVERTON CA", "CORNER CAFE RIVERTON"],
  ["US Toast-like processor, a dash", "TST* NOODLE BAR - RIVERTON", "NOODLE BAR"],
  ["US processor with spaces", "SP * PIXELPLAY STORE", "PIXELPLAY STORE"],
  ["US store number", "GREENMARKET #0423 RIVERTON CA", "GREENMARKET"],
  [
    "US authorised purchase",
    "PURCHASE AUTHORIZED ON 10/21 SQ *CORNER CAFE RIVERTON CA S386294 CARD 1234",
    "CORNER CAFE RIVERTON",
  ],
  ["US debit card purchase", "DEBIT CARD PURCHASE - FUELSTOP 0412 RIVERTON TX", "FUELSTOP"],
  ["US check card", "CHECKCARD 1021 RIVERSIDE GYM RIVERTON NY", "RIVERSIDE GYM RIVERTON"],
  ["US ACH debit", "ACH DEBIT NORTHWIND ENERGY INC", "NORTHWIND ENERGY"],
  // German.
  [
    "German card payment",
    "KARTENZAHLUNG GREENMARKET RIVERTON DE 21.10.2026 10:15",
    "GREENMARKET RIVERTON",
  ],
  [
    "German SEPA direct debit",
    "SEPA-LASTSCHRIFT NORTHWIND ENERGIE GMBH EREF+NWE2026 MREF+M42",
    "NORTHWIND ENERGIE",
  ],
  ["German GmbH & Co KG", "LASTSCHRIFT NORTHWIND ENERGIE GMBH & CO KG", "NORTHWIND ENERGIE"],
  ["German transfer, SVWZ+", "UEBERWEISUNG ACME WIDGETS AG SVWZ+RECHNUNG 4711", "ACME WIDGETS"],
  ["German debit card, //", "GIROCARD GREENMARKET//RIVERTON/DE", "GREENMARKET"],
  ["German lower case and umlaut", "Kartenzahlung Bäckerei Sonnenschein", "BACKEREI SONNENSCHEIN"],
  ["German withdrawal", "BARGELDAUSZAHLUNG GELDAUTOMAT RIVERTON", null],
  // Belgian and Swiss.
  [
    "Belgian Bancontact",
    "PAIEMENT BANCONTACT GREENMARKET RIVERTON 21/10 10:15 CARTE 6703 XXXX XXXX 1234",
    "GREENMARKET RIVERTON",
  ],
  ["Belgian direct debit", "DOMICILIATION EUROPEENNE NORTHWIND ENERGIE SA", "NORTHWIND ENERGIE"],
  [
    "Swiss French card",
    "ACHAT/SERVICE DU 21.10.2026 CARTE N° XXXX1234 GREENMARKET RIVERTON",
    "GREENMARKET RIVERTON",
  ],
  [
    "Swiss German card",
    "KAUF/DIENSTLEISTUNG VOM 21.10.2026 KARTENNUMMER XXXX1234 CORNER CAFE RIVERTON",
    "CORNER CAFE RIVERTON",
  ],
  ["Belgian Maestro", "PAIEMENT MAESTRO 21/10 CORNER CAFE RIVERTON BE", "CORNER CAFE RIVERTON"],
  ["Swiss withdrawal", "RETRAIT BANCOMAT RIVERTON", null],
  // Online shops and intermediaries.
  ["a web address", "CB WWW.ACMEWIDGETS.CO.UK 21/10", "ACMEWIDGETS"],
  ["a web address with a path", "PIXELPLAY.COM/BILL", "PIXELPLAY"],
  ["an intermediary keeps its own key", "PAYLINK *PIXELPLAY", "PAYLINK"],
  ["an intermediary after CB", "CB PAYLINK *PIXELPLAY 21/10", "PAYLINK"],
  ["a legal form and a country", "ACME WIDGETS SARL FR", "ACME WIDGETS"],
  ["a short name", "TLX", "TLX"],
  // Nothing names anyone.
  ["only references", "20261021 000123 XK42", null],
  ["only a structured reference", "REF: 123456789", null],
  ["only payment words", "CB VISA", null],
  ["an empty label", "", null],
  ["only spaces", "   ", null],
];

describe("merchant key of a label", () => {
  test.each(LABELS)("%s: %s", (_case, label, key) => {
    expect(merchantKey(label, null)).toBe(key);
  });

  test("the counterparty's name is preferred when it gives a key", () => {
    expect(merchantKey("VIR SEPA RECU REF 12345", "Acme Conseil SAS")).toBe("ACME CONSEIL");
  });

  test("the label is read when the counterparty's name gives nothing", () => {
    expect(merchantKey("CB GREENMARKET 2110", "")).toBe("GREENMARKET");
    expect(merchantKey("PRLV SEPA NORTHWIND ENERGIE", "123456")).toBe("NORTHWIND ENERGIE");
  });

  test("a cash withdrawal has no merchant, whatever the counterparty", () => {
    expect(merchantKey("RETRAIT DAB 21/10", "Riverton Savings")).toBeNull();
  });

  test("a free text stops at the longest key, on a word, and its name is no longer", () => {
    const label = `VIREMENT ${"GREENMARKET RIVERTON PICNIC BASKETS AND ".repeat(5)}`;
    const key = merchantKey(label, null) ?? "";

    expect(key.length).toBeGreaterThan(MAX_KEY_LENGTH - 20);
    expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
    expect(key.startsWith("GREENMARKET RIVERTON PICNIC")).toBe(true);
    expect(merchantName(key)).toHaveLength(key.length);
    expect(merchantKey(key, null)).toBe(key);
  });

  test("one word longer than a key is cut to it", () => {
    expect(merchantKey(`CB ${"Q".repeat(3000)}`, null)).toBe("Q".repeat(MAX_KEY_LENGTH));
  });

  const tokens = fc.constantFrom(
    "CB",
    "CARTE",
    "PRLV",
    "SEPA",
    "VIR",
    "GREENMARKET",
    "CORNER",
    "CAFE",
    "L'ATELIER",
    "RIVERTON",
    "2110",
    "21/10/26",
    "21",
    "OCT",
    "X1234",
    "#0423",
    "*",
    "SQ *",
    "//",
    " - ",
    "/DE",
    "/MOTIF",
    "REF:",
    "DE:",
    "23,40 EUR",
    "WWW.",
    ".COM",
    "SAS",
    "FR",
    "CA",
    "ON",
    "&",
    "'",
    "É",
    "ß",
    "ATM",
    "10:15",
  );

  const labels = fc.oneof(
    fc.string(),
    fc.string({ unit: "binary" }),
    fc.array(tokens, { maxLength: 10 }).map((words) => words.join(" ")),
    fc.array(tokens, { maxLength: 10 }).map((words) => words.join("")),
    // Long enough to reach the longest key.
    fc.array(tokens, { minLength: 20, maxLength: 80 }).map((words) => words.join(" ")),
  );

  test("never throws, and gives only upper-case words with single spaces", () => {
    fc.assert(
      fc.property(labels, fc.option(labels), (label, counterparty) => {
        const key = merchantKey(label, counterparty);

        if (key !== null) {
          expect(key).toMatch(/^[A-Z0-9&']+(?: [A-Z0-9&']+)*$/);
          expect(key.length).toBeLessThanOrEqual(MAX_KEY_LENGTH);
        }
      }),
      { numRuns: 2000 },
    );
  });

  test("is its own key: a key read again gives itself", () => {
    fc.assert(
      fc.property(labels, (label) => {
        const key = merchantKey(label, null);

        if (key !== null) {
          expect(merchantKey(key, null)).toBe(key);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("merchant name of a key", () => {
  test.each([
    ["GREENMARKET", "Greenmarket"],
    ["CORNER CAFE", "Corner Cafe"],
    ["L'ATELIER BLEU", "L'Atelier Bleu"],
    ["TLX", "TLX"],
    ["MARCHE DE LA PLACE & CIE", "Marche De La Place & Cie"],
    ["AUJOURD'HUI", "Aujourd'hui"],
    ["CAFE 21", "Cafe 21"],
  ])("%s is named %s", (key, name) => {
    expect(merchantName(key)).toBe(name);
  });
});

describe("name key of a merchant's name", () => {
  test("a name compares as its key", () => {
    expect(nameKey("Corner Café")).toBe("CORNER CAFE");
    expect(nameKey("Acme Widgets Ltd")).toBe("ACME WIDGETS");
  });

  test("a name that gives no key compares upper-cased and cleaned", () => {
    expect(nameKey("Visa")).toBe("VISA");
    expect(nameKey("Cash  machine (ATM)")).toBe("CASH MACHINE ATM");
  });

  test("a merchant named from a key compares as that key", () => {
    for (const [, label] of LABELS) {
      const key = merchantKey(label, null);

      if (key !== null) {
        expect(nameKey(merchantName(key))).toBe(key);
      }
    }
  });
});

describe("assigning keys to merchants", () => {
  test("the same shop under several labels becomes one merchant", () => {
    const keys = [
      "CB GREENMARKET 2110 RIVERTON",
      "PAIEMENT PAR CARTE GREENMARKET RIVERTON 21/10",
      "KARTENZAHLUNG GREENMARKET RIVERTON DE 21.10.2026 10:15",
      "GREENMARKET #0423 RIVERTON CA",
      "POS 21OCT GREEN MARKET RIVERTON GB",
    ].map((label) => merchantKey(label, null) ?? "");

    expect(assignMerchants(keys, [])).toEqual([
      { alias: "GREENMARKET", merchant: { name: "Greenmarket" } },
      { alias: "GREENMARKET RIVERTON", merchant: { name: "Greenmarket" } },
      { alias: "GREEN MARKET RIVERTON", merchant: { name: "Greenmarket" } },
    ]);
  });

  test("the shortest key of a batch names the merchant the longer ones join", () => {
    expect(assignMerchants(["CORNER CAFE RIVERTON", "CORNER CAFE"], [])).toEqual([
      { alias: "CORNER CAFE", merchant: { name: "Corner Cafe" } },
      { alias: "CORNER CAFE RIVERTON", merchant: { name: "Corner Cafe" } },
    ]);
  });

  test("tens of thousands of new keys are each matched by lookups, not against every other", () => {
    // Invented stalls STALLAAAA, STALLAAAB…: letters only, no X (which reads as a masked card).
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWYZ";

    const keys = Array.from({ length: 40_000 }, (_unused, index) => {
      const code = Array.from(
        { length: 4 },
        (_digit, place) =>
          letters[Math.floor(index / letters.length ** (3 - place)) % letters.length] ?? "A",
      ).join("");

      return `STALL${code}`;
    });

    const assigned = assignMerchants(keys, [{ key: "STALLAAAA", merchantId: "known" }]);

    expect(assigned).toHaveLength(40_000);
    expect(assigned[0]).toEqual({ alias: "STALLAAAA", merchant: { id: "known" } });
    expect(new Set(assigned.map((each) => JSON.stringify(each.merchant))).size).toBe(40_000);
  });

  test("two spellings of one name become one merchant", () => {
    expect(assignMerchants(["L ATELIER", "L'ATELIER"], [])).toEqual([
      { alias: "L'ATELIER", merchant: { name: "L'Atelier" } },
      { alias: "L ATELIER", merchant: { name: "L'Atelier" } },
    ]);
  });

  test("a key goes to a known merchant whose key it spells, or starts with", () => {
    const known: Array<KnownKey> = [{ key: "GREENMARKET", merchantId: "m1" }];

    expect(assignMerchants(["GREEN MARKET", "GREENMARKET RIVERTON"], known)).toEqual([
      { alias: "GREEN MARKET", merchant: { id: "m1" } },
      { alias: "GREENMARKET RIVERTON", merchant: { id: "m1" } },
    ]);
  });

  test("a key equal to a known key still gets its alias", () => {
    const known: Array<KnownKey> = [{ key: "GREENMARKET", merchantId: "m1" }];

    expect(assignMerchants(["GREENMARKET"], known)).toEqual([
      { alias: "GREENMARKET", merchant: { id: "m1" } },
    ]);
  });

  test("a renamed merchant is found by its name key", () => {
    const known: Array<KnownKey> = [
      { key: "PXP STORE", merchantId: "m2" },
      { key: nameKey("Pixelplay"), merchantId: "m2" },
    ];

    expect(assignMerchants(["PIXEL PLAY", "PIXELPLAY STORE"], known)).toEqual([
      { alias: "PIXEL PLAY", merchant: { id: "m2" } },
      { alias: "PIXELPLAY STORE", merchant: { id: "m2" } },
    ]);
  });

  test("the longest known key that starts the new one wins", () => {
    const known: Array<KnownKey> = [
      { key: "CORNER", merchantId: "short" },
      { key: "CORNER CAFE", merchantId: "long" },
    ];

    expect(assignMerchants(["CORNER CAFE RIVERTON"], known)).toEqual([
      { alias: "CORNER CAFE RIVERTON", merchant: { id: "long" } },
    ]);
  });

  test("two merchants tied on the longest start give a new merchant", () => {
    const known: Array<KnownKey> = [
      { key: "CORNER CAFE", merchantId: "a" },
      { key: "CORNERCAFE", merchantId: "b" },
    ];

    expect(assignMerchants(["CORNER CAFE RIVERTON"], known)).toEqual([
      { alias: "CORNER CAFE RIVERTON", merchant: { name: "Corner Cafe Riverton" } },
    ]);
  });

  test("a known key shorter than four letters does not take longer keys", () => {
    const known: Array<KnownKey> = [{ key: "BAR", merchantId: "m3" }];

    expect(assignMerchants(["BAR RIVERTON"], known)).toEqual([
      { alias: "BAR RIVERTON", merchant: { name: "Bar Riverton" } },
    ]);
  });

  test("a key that starts the keys of one merchant goes to it, not of two", () => {
    const one: Array<KnownKey> = [{ key: "NORTHWIND ENERGIE", merchantId: "m4" }];
    const two: Array<KnownKey> = [...one, { key: "NORTHWIND BIKES", merchantId: "m5" }];

    expect(assignMerchants(["NORTHWIND"], one)).toEqual([
      { alias: "NORTHWIND", merchant: { id: "m4" } },
    ]);

    expect(assignMerchants(["NORTHWIND"], two)).toEqual([
      { alias: "NORTHWIND", merchant: { name: "Northwind" } },
    ]);
  });

  test("a key longer than a marked intermediary's gets a merchant of its own", () => {
    const known: Array<KnownKey> = [{ key: "LYDIA", merchantId: "lydia", intermediary: true }];

    expect(assignMerchants(["LYDIA MARTIN", "LY DIA"], known, isKnownIntermediary)).toEqual([
      { alias: "LY DIA", merchant: { id: "lydia" } },
      { alias: "LYDIA MARTIN", merchant: { name: "Lydia Martin" } },
    ]);

    const paypal: Array<KnownKey> = [{ key: "PAYPAL", merchantId: "paypal", intermediary: true }];

    expect(assignMerchants(["PAYPAL EUROPE"], paypal, isKnownIntermediary)).toEqual([
      { alias: "PAYPAL EUROPE", merchant: { name: "Paypal Europe" } },
    ]);
  });

  test("an intermediary's key made in the same run takes no longer key", () => {
    expect(assignMerchants(["LYDIA MARTIN", "LYDIA"], [], isKnownIntermediary)).toEqual([
      { alias: "LYDIA", merchant: { name: "Lydia" } },
      { alias: "LYDIA MARTIN", merchant: { name: "Lydia Martin" } },
    ]);
  });

  test("an intermediary's key joins no merchant whose longer key it starts", () => {
    const known: Array<KnownKey> = [{ key: "PAYPAL EUROPE", merchantId: "company" }];

    expect(assignMerchants(["PAYPAL"], known, isKnownIntermediary)).toEqual([
      { alias: "PAYPAL", merchant: { name: "Paypal" } },
    ]);
  });

  test("a label the user gives a merchant made by hand names the next lines of that shop (#204)", () => {
    // Made by hand from a label the user typed: its cleaned label is the merchant's alias.
    const alias = merchantKey("CB JUNIPER HARDWARE 0910", null);
    const known: Array<KnownKey> = [{ key: alias ?? "", merchantId: "made-by-hand" }];

    expect(alias).toBe("JUNIPER HARDWARE");

    // A later line spelled the same way cleans to that alias: it is the merchant's, and
    // recognition makes nothing for it, as it never moves a known alias.
    expect(merchantKey("CB JUNIPER HARDWARE 2310", null)).toBe(alias);

    // One that adds the town joins it by its start, as an imported one would.
    expect(assignMerchants([merchantKey("JUNIPER HARDWARE RIVERTON", null) ?? ""], known)).toEqual([
      { alias: "JUNIPER HARDWARE RIVERTON", merchant: { id: "made-by-hand" } },
    ]);
  });

  test("a key starting a merchant's that is no intermediary still joins it", () => {
    const known: Array<KnownKey> = [
      { key: "GREENMARKET", merchantId: "m1", intermediary: false },
      { key: "NORTHWIND ENERGIE", merchantId: "m4" },
    ];

    expect(
      assignMerchants(["GREENMARKET RIVERTON", "NORTHWIND"], known, isKnownIntermediary),
    ).toEqual([
      { alias: "NORTHWIND", merchant: { id: "m4" } },
      { alias: "GREENMARKET RIVERTON", merchant: { id: "m1" } },
    ]);
  });

  test("a key given twice is assigned once", () => {
    expect(assignMerchants(["TLX", "TLX"], [])).toEqual([
      { alias: "TLX", merchant: { name: "TLX" } },
    ]);
  });

  const pool = [
    "GREENMARKET",
    "GREEN MARKET",
    "GREENMARKET RIVERTON",
    "CORNER CAFE",
    "CORNER CAFE RIVERTON",
    "CORNERCAFE",
    "NORTHWIND",
    "NORTHWIND ENERGIE",
    "NORTHWIND BIKES",
    "L'ATELIER",
    "L ATELIER",
    "TLX",
    "BAR",
    "BAR RIVERTON",
    "LYDIA",
    "LYDIA MARTIN",
    "PAYPAL",
    "PAYPAL EUROPE",
  ];

  const knownKeys = fc.array(
    fc.record({
      key: fc.constantFrom(...pool),
      merchantId: fc.constantFrom("a", "b", "c"),
      intermediary: fc.boolean(),
    }),
    { maxLength: 5 },
  );

  test("gives one assignment per distinct key, whatever the order of the keys", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(pool), knownKeys, (keys, known) => {
        const assigned = assignMerchants(keys, known, isKnownIntermediary);
        const again = [...keys, ...keys].toReversed();

        expect(assigned).toEqual(assignMerchants([...keys].toSorted(), known, isKnownIntermediary));
        expect(assigned).toEqual(assignMerchants(again, known, isKnownIntermediary));
        expect(assigned.map(({ alias }) => alias).toSorted()).toEqual(keys.toSorted());
      }),
    );
  });
});
