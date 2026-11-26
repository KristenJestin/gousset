import { describe, expect, test } from "vite-plus/test";

import { costsOf, countedIn, makesCycle, monthsOf, subtreeOf, sumsOf, treeOrder } from "./counting";
import type { CostPart, SubjectNode } from "./counting";

// The subjects' counting rule (#37): every made-up subject and expense here is invented.

const house: SubjectNode = { id: "house", parentId: null, name: "House" };
const shed: SubjectNode = { id: "shed", parentId: "house", name: "Garden shed" };
const roof: SubjectNode = { id: "roof", parentId: "shed", name: "roof" };
const van: SubjectNode = { id: "van", parentId: null, name: "Van" };
const alps: SubjectNode = { id: "alps", parentId: null, name: "Alps 2028" };
const nodes = [van, roof, house, alps, shed];

const payment = (entryId: string, amountMinor: number, currency = "EUR"): CostPart => ({
  entryId,
  happenedOn: "2026-10-04",
  categoryId: "fuel",
  role: "payment",
  amountMinor,
  currency,
});

describe("the tree", () => {
  test("parents come first, siblings by name in any case, each with its depth", () => {
    expect(treeOrder(nodes).map((node) => [node.name, node.depth])).toEqual([
      ["Alps 2028", 0],
      ["House", 0],
      ["Garden shed", 1],
      ["roof", 2],
      ["Van", 0],
    ]);
  });

  test("a subject's subtree holds every descendant, at any depth, and nothing else", () => {
    expect([...subtreeOf(nodes, "house")].toSorted()).toEqual(["house", "roof", "shed"]);
    expect([...subtreeOf(nodes, "shed")].toSorted()).toEqual(["roof", "shed"]);
    expect([...subtreeOf(nodes, "van")]).toEqual(["van"]);
  });
});

describe("the cycle walk", () => {
  test("a subject under itself, or under one of its descendants, is a cycle", () => {
    expect(makesCycle(nodes, "house", "house")).toBe(true);
    expect(makesCycle(nodes, "house", "shed")).toBe(true);
    expect(makesCycle(nodes, "house", "roof")).toBe(true);
  });

  test("under another subject, a sibling's child or the top, it is none", () => {
    expect(makesCycle(nodes, "shed", "van")).toBe(false);
    expect(makesCycle(nodes, "roof", "house")).toBe(false);
    expect(makesCycle(nodes, "shed", null)).toBe(false);
    expect(makesCycle(nodes, "van", "roof")).toBe(false);
  });

  test("a loop already among the rows ends the walk", () => {
    const looped: ReadonlyArray<SubjectNode> = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];

    expect(makesCycle(looped, "van", "a")).toBe(false);
  });
});

describe("the counting rule", () => {
  // Fuel on House and on Garden shed, the shed's paint, the van's tyres, a trip's fuel on the
  // van and the trip, and an expense in dollars on the shed.
  const parts: ReadonlyArray<CostPart> = [
    payment("both", 4000),
    payment("paint", 2500),
    { ...payment("paint", 500), role: "refund" },
    payment("tyres", 30_000),
    payment("trip-fuel", 6000),
    payment("dollars", 1200, "USD"),
  ];

  const subjectsOf = new Map([
    ["both", ["house", "shed"]],
    ["paint", ["shed"]],
    ["tyres", ["van"]],
    ["trip-fuel", ["van", "alps"]],
    ["dollars", ["roof"]],
  ]);

  const costs = costsOf(parts, subjectsOf);
  const totalOf = (id: string) => sumsOf(countedIn(costs, subtreeOf(nodes, id)), "EUR");

  test("an expense on a subject and its parent counts once in the parent", () => {
    expect(countedIn(costs, subtreeOf(nodes, "house")).map((cost) => cost.entryId)).toEqual([
      "both",
      "paint",
      "dollars",
    ]);
    expect(totalOf("house").own).toBe(4000 + 2000);
  });

  test("each expense counts at its net cost: its payments less its refunds", () => {
    expect(totalOf("shed").own).toBe(4000 + 2000);
  });

  test("an expense on several subjects counts whole in each", () => {
    expect(totalOf("van").own).toBe(36_000);
    expect(totalOf("alps").own).toBe(6000);
  });

  test("another currency is given apart, never converted", () => {
    expect(totalOf("house").elsewhere).toEqual([["USD", 1200]]);
    expect(totalOf("roof")).toEqual({ own: 0, elsewhere: [["USD", 1200]] });
    expect(totalOf("van").elsewhere).toEqual([]);
  });
});

describe("the months of a subject's cost", () => {
  test("a year's months up to today's, from the subject's first expense", () => {
    expect(monthsOf("2026-01", "2026-11", "2026-08")).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  test("a first expense before the period starts it at the period's first month", () => {
    expect(monthsOf("2026-01", "2026-03", "2024-05")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  test("all time runs from the first expense, across years", () => {
    expect(monthsOf(null, "2027-02", "2026-11")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  test("no expense, or a first one after the period, gives no month", () => {
    expect(monthsOf("2026-01", "2026-11", null)).toEqual([]);
    expect(monthsOf("2025-01", "2025-12", "2026-02")).toEqual([]);
  });
});
