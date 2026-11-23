import type { CategoryNode, CategoryTree, EntryKind } from "@gousset/core";

/** What the categories page shows: a kind's categories in use, or the archived ones. */
export type CategoryView = EntryKind | "archived";

/** One row of the page's tree: a category, indented or not, by the name it is shown under. */
export type CategoryRowOf = {
  node: CategoryNode;
  /** Indented under the row before it. */
  child: boolean;
  /** Its name; a child shown without its parent goes by its path ("Housing › Old flat"). */
  name: string;
};

/** Between a parent's name and its child's, wherever a child is named alone. */
const PATH = " › ";

/** A category's name, after its parent's for a child: "Housing › Rent". */
export function categoryPath(category: { name: string; parentName: string | null }): string {
  return category.parentName === null
    ? category.name
    : `${category.parentName}${PATH}${category.name}`;
}

const inUse = (node: CategoryNode) => node.archivedAt === null;

/**
 * The rows of a view, in order: each top-level category in use then its children in use; or, in
 * the archived view, each archived top-level category with its archived children, and an archived
 * child of a category in use alone, by its path.
 */
export function rowsOf(tree: CategoryTree, view: CategoryView): Array<CategoryRowOf> {
  if (view !== "archived") {
    return tree[view]
      .filter(inUse)
      .flatMap((top) => [
        { node: top, child: false, name: top.name },
        ...top.children
          .filter(inUse)
          .map((child) => ({ node: child, child: true, name: child.name })),
      ]);
  }

  return [...tree.expense, ...tree.income].flatMap((top) => {
    const archived = top.children.filter((child) => !inUse(child));

    return inUse(top)
      ? archived.map((child) => ({
          node: child,
          child: false,
          name: categoryPath({ name: child.name, parentName: top.name }),
        }))
      : [
          { node: top, child: false, name: top.name },
          ...archived.map((child) => ({ node: child, child: true, name: child.name })),
        ];
  });
}

/**
 * The categories of a kind that can be chosen (for a line, or as a merge's target): in use, top
 * level ones with their children, leaving `except` out.
 */
export function choicesOf(tree: CategoryTree, kind: EntryKind, except?: string) {
  const offered = (node: CategoryNode) => inUse(node) && node.id !== except;

  return tree[kind].filter(offered).map((top) => ({
    id: top.id,
    name: top.name,
    children: top.children.filter(offered).map((child) => ({ id: child.id, name: child.name })),
  }));
}

/** The top-level categories in use a category of `kind` may go under: never itself. */
export function parentsOf(tree: CategoryTree, kind: EntryKind, except?: string) {
  return tree[kind]
    .filter((top) => inUse(top) && top.id !== except)
    .map((top) => ({ id: top.id, name: top.name }));
}
