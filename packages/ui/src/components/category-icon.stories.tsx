import type { Meta, StoryObj } from "@storybook/react-vite";

import { CATEGORIES } from "../stories/made-up";
import { CategoryIcon } from "./category-icon";
import { CATEGORY_ICON_NAMES } from "./icons";

/**
 * A category's icon on a small neutral tile, beside the category's name in a row, a breakdown or
 * a detail. The icon is chosen in `icons.ts`; the user picks among those. `null` is the
 * uncategorised form: a dashed, empty tile that says "Uncategorised" to screen readers. Sizes
 * match `MerchantLogo` (24, 32, 40 px), so both line up in the same rows.
 *
 * Motion: none; it does not move.
 *
 * Don't: colour the tile by category (colour is for money roles and states), use an emoji or an
 * icon from elsewhere, or give it a label when the name already sits beside it.
 */
const meta = {
  title: "Data/CategoryIcon",
  component: CategoryIcon,
  args: { icon: "groceries" },
} satisfies Meta<typeof CategoryIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Rounded: Story = { args: { corners: "rounded" } };

/** No category yet: dashed and empty, announced as "Uncategorised". */
export const Uncategorised: Story = { args: { icon: null } };

/** 24, 32 and 40 px, round and rounded, with the uncategorised form. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["round", "rounded"] as const).map((corners) => (
        <div key={corners} className="flex items-center gap-3">
          {(["sm", "md", "lg"] as const).map((size) => (
            <CategoryIcon key={size} icon="restaurants" size={size} corners={corners} />
          ))}
          {(["sm", "md", "lg"] as const).map((size) => (
            <CategoryIcon key={`none-${size}`} icon={null} size={size} corners={corners} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** Every icon a category may take, in the order they are offered. */
export const Every: Story = {
  render: () => (
    <div className="grid grid-cols-7 gap-3">
      {CATEGORY_ICON_NAMES.map((name) => (
        <CategoryIcon key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};

/** In rows, beside the name. */
export const InRows: Story = {
  render: () => (
    <ul className="flex max-w-xs flex-col gap-2">
      {CATEGORIES.slice(0, 4).map((category) => (
        <li key={category.id} className="flex items-center gap-3 text-sm">
          <CategoryIcon icon={category.icon} size="sm" />
          {category.name}
        </li>
      ))}
      <li className="flex items-center gap-3 text-sm text-muted-foreground">
        <CategoryIcon icon={null} size="sm" />
        To sort
      </li>
    </ul>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => (
    <div className="grid grid-cols-5 gap-3">
      {CATEGORY_ICON_NAMES.map((name) => (
        <CategoryIcon key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};
