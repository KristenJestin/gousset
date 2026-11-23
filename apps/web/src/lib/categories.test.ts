import type { CategoryNode, CategoryTree } from "@gousset/core";
import { describe, expect, test } from "vite-plus/test";

import { categoryPath, choicesOf, parentsOf, rowsOf } from "./categories";

/** A made-up category; children are given their parent's id. */
function node(
  id: string,
  edit: Partial<CategoryNode> = {},
  children: ReadonlyArray<CategoryNode> = [],
): CategoryNode {
  return {
    id,
    kind: "expense",
    name: id,
    icon: null,
    position: 0,
    parentId: null,
    archivedAt: null,
    fallback: false,
    benchmark: { mode: "automatic" },
    entries: 0,
    average: [],
    averageWithChildren: [],
    ...edit,
    children: children.map((child) => ({ ...child, parentId: id })),
  };
}

const ARCHIVED = "2026-11-01T10:00:00.000Z";

const TREE: CategoryTree = {
  expense: [
    node("Housing", {}, [node("Rent"), node("Old flat", { archivedAt: ARCHIVED })]),
    node("Hobbies", { archivedAt: ARCHIVED }, [node("Kites", { archivedAt: ARCHIVED })]),
    node("Other", { fallback: true }),
  ],
  income: [node("Salary", { kind: "income" }, [node("Pay", { kind: "income" })])],
  averageFrom: "2026-05-01",
  averageTo: "2026-10-31",
};

const names = (rows: ReturnType<typeof rowsOf>) =>
  rows.map((row) => `${row.child ? "  " : ""}${row.name}`);

describe("rowsOf", () => {
  test("a kind's categories in use, each parent then its children", () => {
    expect(names(rowsOf(TREE, "expense"))).toEqual(["Housing", "  Rent", "Other"]);
    expect(names(rowsOf(TREE, "income"))).toEqual(["Salary", "  Pay"]);
  });

  test("the archived ones: a parent with its children, a child alone by its path", () => {
    expect(names(rowsOf(TREE, "archived"))).toEqual(["Housing › Old flat", "Hobbies", "  Kites"]);
  });
});

describe("choicesOf", () => {
  test("a kind's categories in use, but the one left out", () => {
    expect(choicesOf(TREE, "expense", "Rent")).toEqual([
      { id: "Housing", name: "Housing", children: [] },
      { id: "Other", name: "Other", children: [] },
    ]);
    expect(choicesOf(TREE, "income")).toEqual([
      { id: "Salary", name: "Salary", children: [{ id: "Pay", name: "Pay" }] },
    ]);
  });
});

describe("parentsOf", () => {
  test("the top-level categories in use a category may go under, never itself", () => {
    expect(parentsOf(TREE, "expense", "Housing")).toEqual([{ id: "Other", name: "Other" }]);
  });
});

describe("categoryPath", () => {
  test("a child after its parent, a top-level category alone", () => {
    expect(categoryPath({ name: "Rent", parentName: "Housing" })).toBe("Housing › Rent");
    expect(categoryPath({ name: "Other", parentName: null })).toBe("Other");
  });
});
