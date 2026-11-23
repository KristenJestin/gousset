import { describe, expect, test } from "vite-plus/test";

import { changes, firstApplying, targetOf } from "./effect";
import type { EffectFacts, RuleEntry, RuleSets } from "./effect";

// What a rule makes of an entry (#25): the category and merchant it sets, when its category is of
// the entry's kind and not archived; a merchant alone brings the merchant's default category.

const FACTS: EffectFacts = {
  categories: new Map([
    ["groceries", { kind: "expense", archived: false }],
    ["old-groceries", { kind: "expense", archived: true }],
    ["salary", { kind: "income", archived: false }],
    ["other-expense", { kind: "expense", archived: false }],
  ]),
  defaults: new Map([
    ["greenmarket", "groceries"],
    ["employer", "salary"],
  ]),
};

const entry = (change: Partial<RuleEntry> = {}): RuleEntry => ({
  id: "entry",
  kind: "expense",
  categoryId: "other-expense",
  merchantId: null,
  classifiedBy: "default",
  ruleId: null,
  ...change,
});

const sets = (change: Partial<RuleSets>): RuleSets => ({
  setMerchantId: null,
  setCategoryId: null,
  ...change,
});

describe("a rule's effect on an entry", () => {
  test("sets its category and merchant", () => {
    expect(
      targetOf(sets({ setCategoryId: "groceries", setMerchantId: "greenmarket" }), entry(), FACTS),
    ).toEqual({ categoryId: "groceries", merchantId: "greenmarket" });
  });

  test("keeps the entry's merchant when it sets a category only", () => {
    expect(
      targetOf(sets({ setCategoryId: "groceries" }), entry({ merchantId: "cornershop" }), FACTS),
    ).toEqual({ categoryId: "groceries", merchantId: "cornershop" });
  });

  test("does not apply to an entry of the other kind, nor with an archived category", () => {
    expect(targetOf(sets({ setCategoryId: "salary" }), entry(), FACTS)).toBeNull();
    expect(targetOf(sets({ setCategoryId: "old-groceries" }), entry(), FACTS)).toBeNull();
    expect(targetOf(sets({ setCategoryId: "unknown" }), entry(), FACTS)).toBeNull();
  });

  test("brings a merchant's default category of the entry's kind, else keeps the category", () => {
    expect(targetOf(sets({ setMerchantId: "greenmarket" }), entry(), FACTS)).toEqual({
      categoryId: "groceries",
      merchantId: "greenmarket",
    });

    expect(targetOf(sets({ setMerchantId: "employer" }), entry(), FACTS)).toEqual({
      categoryId: "other-expense",
      merchantId: "employer",
    });

    expect(targetOf(sets({ setMerchantId: "cornershop" }), entry(), FACTS)).toEqual({
      categoryId: "other-expense",
      merchantId: "cornershop",
    });
  });

  test("of a rule that sets nothing is none", () => {
    expect(targetOf(sets({}), entry(), FACTS)).toBeNull();
  });

  test("changes an entry until it is as the rule leaves it, by that rule", () => {
    const wanted = { categoryId: "groceries", merchantId: "greenmarket" };
    const done = entry({ ...wanted, classifiedBy: "rule", ruleId: "rule-1" });

    expect(changes(done, "rule-1", wanted)).toBe(false);
    expect(changes(done, "rule-2", wanted)).toBe(true);
    expect(changes({ ...done, classifiedBy: "user", ruleId: null }, "rule-1", wanted)).toBe(true);
    expect(changes({ ...done, merchantId: null }, "rule-1", wanted)).toBe(true);
  });
});

describe("the rule that classifies an entry", () => {
  const rules = [
    { id: "first", ...sets({ setCategoryId: "salary" }) },
    { id: "second", ...sets({ setCategoryId: "groceries" }) },
    { id: "third", ...sets({ setCategoryId: "other-expense" }) },
  ];

  test("is the first, in order, that the line meets and that applies to the entry", () => {
    expect(firstApplying(rules, () => true, entry(), FACTS)?.rule.id).toBe("second");
    expect(firstApplying(rules, (rule) => rule.id === "third", entry(), FACTS)?.rule.id).toBe(
      "third",
    );
  });

  test("is none when the line meets none", () => {
    expect(firstApplying(rules, () => false, entry(), FACTS)).toBeNull();
  });
});
