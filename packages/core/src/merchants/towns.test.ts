import { describe, expect, test } from "vite-plus/test";

import { shopsOf } from "./towns";

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
