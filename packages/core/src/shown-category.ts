import { category } from "@gousset/db/schema/ledger";
import { alias } from "drizzle-orm/pg-core";

// What a category is shown with, wherever a query reads it beside a line, an expense, a rule or a
// merchant (`lineCategoryOf`, `./category-store`): its names, its icon, and its colour or its
// parent's (#205). One selection, so that each of those queries reads the same columns.

/** A category's parent: `leftJoin(categoryParent, eq(categoryParent.id, category.parentId))`. */
export const categoryParent = alias(category, "parent");

/** The columns `lineCategoryOf` reads, from `category` and `categoryParent` (left join). */
export const shownCategoryColumns = {
  id: category.id,
  name: category.name,
  kind: category.kind,
  icon: category.icon,
  color: category.color,
  parentName: categoryParent.name,
  parentColor: categoryParent.color,
};
