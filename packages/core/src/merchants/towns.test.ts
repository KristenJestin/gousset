import { describe, expect, test } from "vite-plus/test";

import { shopsOf, shopsOfLines, sureShopsOf } from "./towns";

// Every shop and town here is invented.

/** Each key whose town is dropped, with what is left: the shop. */
const shops = (keys: ReadonlyArray<string>) => Object.fromEntries(shopsOf(keys));

/** Two shops each paid in Riverton and in Lakeside: the user's card labels show both towns. */
const KNOWN_TOWNS = [
  "FRESHMART RIVERTON",
  "FRESHMART LAKESIDE",
  "CORNER CAFE RIVERTON",
  "CORNER CAFE LAKESIDE",
];

const KNOWN_SHOPS = {
  "FRESHMART RIVERTON": "FRESHMART",
  "FRESHMART LAKESIDE": "FRESHMART",
  "CORNER CAFE RIVERTON": "CORNER CAFE",
  "CORNER CAFE LAKESIDE": "CORNER CAFE",
};

/** Each key whose sure town is dropped, with what is left. */
const sure = (keys: ReadonlyArray<string>) => Object.fromEntries(sureShopsOf(keys));

describe("the towns the boot's merge is sure of", () => {
  /** Three shops each paid in Riverton and in Lakeside. */
  const THREE_SHOPS = [
    "PIZZA NOVA RIVERTON",
    "PIZZA NOVA LAKESIDE",
    "FRESHMART RIVERTON",
    "FRESHMART LAKESIDE",
    "BOOKMILL RIVERTON",
    "BOOKMILL LAKESIDE",
  ];

  test("a town where three shops were paid, each paid in another such town", () => {
    expect(sure(THREE_SHOPS)).toEqual({
      "PIZZA NOVA RIVERTON": "PIZZA NOVA",
      "PIZZA NOVA LAKESIDE": "PIZZA NOVA",
      "FRESHMART RIVERTON": "FRESHMART",
      "FRESHMART LAKESIDE": "FRESHMART",
      "BOOKMILL RIVERTON": "BOOKMILL",
      "BOOKMILL LAKESIDE": "BOOKMILL",
    });
  });

  test("two pairs of names sharing their words are no sure towns", () => {
    expect(
      sure(["CORNER CAFE", "CORNER BAKERY", "GRAND CAFE", "GRAND BAKERY", "PORT CAFE"]),
    ).toEqual({});
  });

  test("a doubled last word, and a town cut short, are no sure towns", () => {
    expect(sure([...THREE_SHOPS, "CAFE BORA BORA", "PIZZA NOVA RIVERT"])).not.toHaveProperty(
      "CAFE BORA BORA",
    );
    expect(sure([...THREE_SHOPS, "PIZZA NOVA RIVERT"])).not.toHaveProperty("PIZZA NOVA RIVERT");
  });

  test("a sure town doubled at a label's end goes with both its copies", () => {
    expect(sure([...THREE_SHOPS, "FRESHMART RIVERTON RIVERTON"])).toHaveProperty(
      "FRESHMART RIVERTON RIVERTON",
      "FRESHMART",
    );
  });
});

describe("a card label's trailing town", () => {
  test("one shop in three towns is one shop", () => {
    expect(
      shops([
        "PIZZA NOVA RIVERTON",
        "PIZZA NOVA LAKESIDE",
        "PIZZA NOVA HILLCREST",
        "FRESHMART RIVERTON",
        "FRESHMART LAKESIDE",
        "FRESHMART HILLCREST",
      ]),
    ).toEqual({
      "PIZZA NOVA RIVERTON": "PIZZA NOVA",
      "PIZZA NOVA LAKESIDE": "PIZZA NOVA",
      "PIZZA NOVA HILLCREST": "PIZZA NOVA",
      "FRESHMART RIVERTON": "FRESHMART",
      "FRESHMART LAKESIDE": "FRESHMART",
      "FRESHMART HILLCREST": "FRESHMART",
    });
  });

  test("a known town ends any shop's label, of a shop paid there once too", () => {
    expect(shops([...KNOWN_TOWNS, "PIZZA NOVA RIVERTON"])).toEqual({
      ...KNOWN_SHOPS,
      "PIZZA NOVA RIVERTON": "PIZZA NOVA",
    });
  });

  test("a town of several words, and one cut short after a shop seen in a whole town", () => {
    expect(
      shops([
        ...KNOWN_TOWNS,
        "CODEHUB INC SAN FRANCISCO",
        "CODEHUB INC RIVERTON",
        "FRESHMART SAN FRANCISCO",
        "CODEHUB INC SAN FRANCI",
        "PIZZA NOVA LAKESIDE",
        "PIZZA NOVA RIVERT",
      ]),
    ).toEqual({
      ...KNOWN_SHOPS,
      "FRESHMART SAN FRANCISCO": "FRESHMART",
      "CODEHUB INC SAN FRANCISCO": "CODEHUB",
      "CODEHUB INC RIVERTON": "CODEHUB",
      "CODEHUB INC SAN FRANCI": "CODEHUB",
      "PIZZA NOVA LAKESIDE": "PIZZA NOVA",
      "PIZZA NOVA RIVERT": "PIZZA NOVA",
    });
  });

  test("a doubled town is a town, wherever else it ends a label", () => {
    expect(shops(["FRESHMART RIVERTON RIVERTON", "PIZZA NOVA RIVERTON"])).toEqual({
      "FRESHMART RIVERTON RIVERTON": "FRESHMART",
      "PIZZA NOVA RIVERTON": "PIZZA NOVA",
    });
  });

  test("a shop whose name ends in a place word that is no town is kept whole", () => {
    expect(
      shops([
        ...KNOWN_TOWNS,
        "CAFE DU PORT",
        "CAFE DU LAC",
        "HOTEL DU PORT",
        "HOTEL DU LAC",
        "CAFE DU PORT RIVERTON",
      ]),
    ).toEqual({ ...KNOWN_SHOPS, "CAFE DU PORT RIVERTON": "CAFE DU PORT" });
  });

  test("one shop in two towns that nothing else shows keeps them: they may be its name", () => {
    expect(shops(["PIZZA NOVA RIVERTON", "PIZZA NOVA LAKESIDE"])).toEqual({});
  });

  test("two shops that share a first word, and a last word with a third, stay apart", () => {
    expect(shops(["BOULANGERIE MARTIN", "BOULANGERIE DUPONT", "GARAGE MARTIN"])).toEqual({});
  });

  test("a word that starts a known town is no town after a shop never seen in one", () => {
    expect(shops([...KNOWN_TOWNS, "GREEN RIVER"])).toEqual(KNOWN_SHOPS);
  });

  test("a name shorter than four letters, or that would end on a small word, keeps its town", () => {
    expect(shops([...KNOWN_TOWNS, "BAR RIVERTON", "CAFE DE LA RIVERTON"])).toEqual(KNOWN_SHOPS);
  });

  test("tens of thousands of card labels in one town are read in one pass each", () => {
    // Invented stalls STALLAAAA, STALLAAAB…, each in Riverton and in a place of its own.
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWYZ";

    const code = (index: number) =>
      Array.from(
        { length: 4 },
        (_digit, place) =>
          letters[Math.floor(index / letters.length ** (3 - place)) % letters.length] ?? "A",
      ).join("");

    const keys = Array.from({ length: 20_000 }, (_unused, index) => [
      `STALL${code(index)} RIVERTON`,
      `STALL${code(index)} PLACE${code(index)}`,
    ]).flat();

    expect(shopsOf(keys).size).toBe(0);
  });

  test("a name before tens of thousands of last words is read in linear time, and is no shop", () => {
    // Invented: two names each followed by 20,000 references of their own, the same for both.
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWYZ";

    const code = (index: number) =>
      Array.from(
        { length: 4 },
        (_digit, place) =>
          letters[Math.floor(index / letters.length ** (3 - place)) % letters.length] ?? "A",
      ).join("");

    const keys = Array.from({ length: 20_000 }, (_unused, index) => [
      `ABCD QR${code(index)}`,
      `EFGH QR${code(index)}`,
    ]).flat();

    const started = performance.now();

    expect(shopsOf(keys).size).toBe(0);
    // Loose: a quadratic reading takes minutes.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test("gives the same shops whatever the order of the keys", () => {
    const keys = [
      ...KNOWN_TOWNS,
      "PIZZA NOVA RIVERTON",
      "PIZZA NOVA RIVERT",
      "FRESHMART RIVERTON RIVERTON",
      "CAFE DU PORT",
    ];

    expect(shops(keys.toReversed())).toEqual(shops(keys));
  });
});

describe("the towns of English card labels (#243)", () => {
  test("`CARD dd/mm` labels show their shops and towns as other card labels do", () => {
    const lines = [
      "CARD 03/10 PIZZA NOVA RIVERTON",
      "CARD 17/10 PIZZA NOVA LAKESIDE",
      "CARD 04/10 FRESHMART RIVERTON",
      "CARD 18/10 FRESHMART LAKESIDE",
    ].map((label) => ({ label, counterpartyName: null }));

    expect(Object.fromEntries(shopsOfLines(lines))).toEqual({
      "PIZZA NOVA RIVERTON": "PIZZA NOVA",
      "PIZZA NOVA LAKESIDE": "PIZZA NOVA",
      "FRESHMART RIVERTON": "FRESHMART",
      "FRESHMART LAKESIDE": "FRESHMART",
    });
  });
});
