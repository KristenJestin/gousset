// How a category is shown (#205): its icon and its colour, each a key of a closed list. The keys
// are what a category stores (`category.icon`, `category.color`), so a key is never renamed nor
// removed once released; a drawing or a colour may change behind it. packages/ui draws each key
// (`icons.ts`, and `--category-<key>` in `globals.css`), and its tests keep both lists equal to
// these. This file imports nothing: the browser reads it as `@gousset/core/category-looks`.

/** The icons a category may take, in the order they are offered. */
export const CATEGORY_ICONS = [
  "housing",
  "rent",
  "energy",
  "insurance",
  "repairs",
  "groceries",
  "supermarket",
  "market",
  "bakery",
  "transport",
  "fuel",
  "train",
  "car",
  "parking",
  "restaurants",
  "cafe",
  "takeaway",
  "health",
  "doctor",
  "pharmacy",
  "leisure",
  "sport",
  "culture",
  "travel",
  "hobbies",
  "games",
  "shopping",
  "clothes",
  "electronics",
  "garden",
  "subscriptions",
  "phone",
  "streaming",
  "software",
  "family",
  "children",
  "education",
  "books",
  "gifts",
  "pets",
  "fees",
  "bank",
  "taxes",
  "salary",
  "pay",
  "bonus",
  "benefits",
  "investments",
  "interest",
  "dividends",
  "reimbursements",
  "expense-claims",
  "other",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICONS)[number];

/**
 * The palette a category's colour is chosen from, in the order it is offered: hues around the
 * circle, then a grey. Each holds 4.5:1 or more on the page, the blocks and its own tile, in light
 * and in dark (packages/ui, `contrast.test.ts`).
 */
export const CATEGORY_COLORS = [
  "red",
  "orange",
  "amber",
  "olive",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
  "grey",
] as const;

export type CategoryColorKey = (typeof CATEGORY_COLORS)[number];

const ICON_KEYS: ReadonlySet<string> = new Set(CATEGORY_ICONS);
const COLOR_KEYS: ReadonlySet<string> = new Set(CATEGORY_COLORS);

/** Whether a stored or typed key is one of the category icons. */
export function isCategoryIcon(key: string): key is CategoryIconKey {
  return ICON_KEYS.has(key);
}

/** Whether a stored or typed key is one of the palette's colours. */
export function isCategoryColor(key: string): key is CategoryColorKey {
  return COLOR_KEYS.has(key);
}

/** The colour a category is shown in: its own, else its parent's (a child takes its parent's). */
export function shownColor(
  own: string | null,
  parent: string | null | undefined,
): CategoryColorKey | null {
  const color = own ?? parent ?? null;

  return color !== null && isCategoryColor(color) ? color : null;
}

/** The icon a category is shown with: its own, when it is one of the icons. */
export function shownIcon(own: string | null): CategoryIconKey | null {
  return own !== null && isCategoryIcon(own) ? own : null;
}
