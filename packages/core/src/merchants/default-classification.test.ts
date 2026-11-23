import { describe, expect, test } from "vite-plus/test";

import { defaultCategoryMoves } from "./default-classification";
import type { DefaultEntry, MerchantDefault } from "./default-classification";

// Which entries a merchant's default category moves (#23): those still classified by default, of
// the category's kind, to it; back to their kind's fallback when it has none of their kind.

const FALLBACKS = new Map([
  ["expense", "other-expense"],
  ["income", "other-income"],
] as const);

const entry = (change: Partial<DefaultEntry> = {}): DefaultEntry => ({
  id: "entry",
  kind: "expense",
  categoryId: "other-expense",
  classifiedBy: "default",
  merchantId: "greenmarket",
  ...change,
});

const defaults = (
  ...each: ReadonlyArray<readonly [string, MerchantDefault]>
): ReadonlyMap<string, MerchantDefault> => new Map(each);

const groceries: MerchantDefault = { categoryId: "groceries", kind: "expense", archived: false };

describe("a merchant's default category", () => {
  test("moves its entries still classified by default, of its kind, to it", () => {
    expect(
      defaultCategoryMoves(
        [entry({ id: "a" }), entry({ id: "b", kind: "income", categoryId: "other-income" })],
        defaults(["greenmarket", groceries]),
        FALLBACKS,
      ),
    ).toEqual([{ entryId: "a", categoryId: "groceries" }]);
  });

  test("never moves an entry the user or a rule classified, nor one of no merchant", () => {
    expect(
      defaultCategoryMoves(
        [
          entry({ id: "user", classifiedBy: "user", categoryId: "bakery" }),
          entry({ id: "rule", classifiedBy: "rule", categoryId: "bakery" }),
          entry({ id: "none", merchantId: null }),
        ],
        defaults(["greenmarket", groceries]),
        FALLBACKS,
      ),
    ).toEqual([]);
  });

  test("an entry already in it, or in the fallback with no default, stays", () => {
    expect(
      defaultCategoryMoves(
        [
          entry({ id: "in", categoryId: "groceries" }),
          entry({ id: "free", merchantId: "fuelstop" }),
        ],
        defaults(["greenmarket", groceries]),
        FALLBACKS,
      ),
    ).toEqual([]);
  });

  test("cleared, or of the other kind, its entries go back to their kind's fallback", () => {
    const stillThere = entry({ id: "a", categoryId: "groceries" });

    expect(defaultCategoryMoves([stillThere], defaults(), FALLBACKS)).toEqual([
      { entryId: "a", categoryId: "other-expense" },
    ]);

    expect(
      defaultCategoryMoves(
        [stillThere],
        defaults(["greenmarket", { categoryId: "salary", kind: "income", archived: false }]),
        FALLBACKS,
      ),
    ).toEqual([{ entryId: "a", categoryId: "other-expense" }]);
  });

  test("archived, it classifies nothing new, and keeps the entries it has", () => {
    const archived = defaults(["greenmarket", { ...groceries, archived: true }]);

    expect(
      defaultCategoryMoves(
        [entry({ id: "new" }), entry({ id: "kept", categoryId: "groceries" })],
        archived,
        FALLBACKS,
      ),
    ).toEqual([]);
  });
});
