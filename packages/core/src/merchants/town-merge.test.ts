import { describe, expect, test } from "vite-plus/test";

import { compactOf } from "./labels";
import { isUntouched, plansOf } from "./town-merge";
import type { Held } from "./town-merge";

// Every shop and town here is invented.

const MADE = new Date("2026-10-01T10:00:00.000Z");
const LATER = new Date("2026-10-20T18:30:00.000Z");

/** As recognition makes a merchant: one transaction, its cleaned label written with it. */
const recognised = {
  createdAt: MADE,
  updatedAt: MADE,
  defaultCategoryId: null,
  intermediary: false,
};

const SHOPS = new Map([
  ["PIZZA NOVA RIVERTON", "PIZZA NOVA"],
  ["PIZZA NOVA LAKESIDE", "PIZZA NOVA"],
  ["PIZZA NOVA HILLCREST", "PIZZA NOVA"],
]);

describe("a merchant recognition made, that the user never changed", () => {
  test("named from its cleaned label, written with it", () => {
    expect(
      isUntouched(
        { ...recognised, name: "Pizza Nova Riverton" },
        [{ alias: "PIZZA NOVA RIVERTON", createdAt: MADE }],
        SHOPS,
        false,
      ),
    ).toBe(true);
  });

  test("a merchant a split made is the user's, though named as recognition would", () => {
    // The user moved the cleaned label, written at the import, into a new merchant of this name.
    expect(
      isUntouched(
        { ...recognised, createdAt: LATER, updatedAt: LATER, name: "Pizza Nova Lakeside" },
        [{ alias: "PIZZA NOVA LAKESIDE", createdAt: MADE }],
        SHOPS,
        false,
      ),
    ).toBe(false);
  });

  test("a rename, a default category, a mark, a rule or an entry make it the user's", () => {
    const alias = [{ alias: "PIZZA NOVA RIVERTON", createdAt: MADE }];

    expect(isUntouched({ ...recognised, name: "Pizzeria" }, alias, SHOPS, false)).toBe(false);
    expect(
      isUntouched(
        { ...recognised, name: "Pizza Nova Riverton", updatedAt: LATER },
        alias,
        SHOPS,
        false,
      ),
    ).toBe(false);
    expect(
      isUntouched(
        { ...recognised, name: "Pizza Nova Riverton", defaultCategoryId: "food" },
        alias,
        SHOPS,
        false,
      ),
    ).toBe(false);
    expect(
      isUntouched(
        { ...recognised, name: "Pizza Nova Riverton", intermediary: true },
        alias,
        SHOPS,
        false,
      ),
    ).toBe(false);
    expect(isUntouched({ ...recognised, name: "Pizza Nova Riverton" }, alias, SHOPS, true)).toBe(
      false,
    );
  });
});

/** A merchant of the shop Pizza Nova, as the merge reads it. */
const held = (
  id: string,
  name: string,
  aliases: ReadonlyArray<string>,
  untouched = true,
): Held => ({
  id,
  name,
  aliases,
  untouched,
});

const formOf = (alias: string) => compactOf(SHOPS.get(alias) ?? alias);
const PIZZA_NOVA = new Map([["PIZZANOVA", "PIZZA NOVA"]]);

describe("what the merge makes of a shop's merchants", () => {
  test("the untouched ones go into the first, named after the shop", () => {
    expect(
      plansOf(
        [
          held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"]),
          held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([
      {
        target: held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"]),
        name: "Pizza Nova",
        merged: [held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"])],
      },
    ]);
  });

  test("into an untouched one already named after the shop, which keeps its name", () => {
    expect(
      plansOf(
        [
          held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"]),
          held("b", "Pizza Nova", ["PIZZA NOVA HILLCREST"]),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([
      {
        target: held("b", "Pizza Nova", ["PIZZA NOVA HILLCREST"]),
        name: undefined,
        merged: [held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"])],
      },
    ]);
  });

  test("a merchant the user changed is never touched, nor renamed, nor taken into", () => {
    expect(
      plansOf(
        [
          held("a", "Pizza Nova", ["PIZZA NOVA RIVERTON"], false),
          held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
          held("c", "Pizza Nova Hillcrest", ["PIZZA NOVA HILLCREST"]),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([]);

    expect(
      plansOf(
        [
          held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"], false),
          held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
          held("c", "Pizza Nova Hillcrest", ["PIZZA NOVA HILLCREST"]),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([
      {
        target: held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
        name: "Pizza Nova",
        merged: [held("c", "Pizza Nova Hillcrest", ["PIZZA NOVA HILLCREST"])],
      },
    ]);
  });

  test("one merchant alone is never renamed: there is nothing to merge", () => {
    expect(
      plansOf([held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"])], PIZZA_NOVA, formOf),
    ).toEqual([]);
  });

  test("a merchant with a cleaned label of another shop is left as it is", () => {
    expect(
      plansOf(
        [
          held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON", "FRESHMART"]),
          held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([]);
  });

  test("the shop's name held by a merchant of the user's elsewhere: nothing moves", () => {
    expect(
      plansOf(
        [
          held("a", "Pizza Nova Riverton", ["PIZZA NOVA RIVERTON"]),
          held("b", "Pizza Nova Lakeside", ["PIZZA NOVA LAKESIDE"]),
          held("c", "Pizza Nova", ["CORNER CAFE"], false),
        ],
        PIZZA_NOVA,
        formOf,
      ),
    ).toEqual([]);
  });
});
