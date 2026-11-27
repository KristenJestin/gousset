import type { Meta, StoryObj } from "@storybook/react-vite";

import { PALETTE_COLORS } from "../lib/palette";
import { cn } from "../lib/utils";
import { CATEGORIES } from "../stories/made-up";
import { CategoryIcon } from "./category-icon";
import { CATEGORY_ICON_NAMES } from "./icons";

/**
 * A category's icon on a small tile, beside the category's name in a row, a breakdown or a
 * detail. The icon is chosen in `icons.ts`; the user picks among those. With a colour (the
 * category's own, else its parent's, #205), the tile takes its tint and the icon its colour, 4.5:1
 * or more in both schemes (`contrast.test.ts`); without one, a neutral tile. `null` is the
 * uncategorised form: a dashed, empty tile that says "Uncategorised" to screen readers. Sizes
 * match `Avatar` (24, 32, 40 px), so both line up in the same rows.
 *
 * Motion: none; it does not move.
 *
 * Don't: use an emoji or an icon from elsewhere, a colour outside the palette, or give it a label
 * when the name already sits beside it.
 */
const meta = {
  title: "Data/CategoryIcon",
  component: CategoryIcon,
  args: { icon: "groceries" },
} satisfies Meta<typeof CategoryIcon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** In its colour: the tile tinted, the icon in the colour. */
export const Coloured: Story = { args: { color: "green" } };

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
            <CategoryIcon
              key={`orange-${size}`}
              icon="restaurants"
              color="orange"
              size={size}
              corners={corners}
            />
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
    <div className="grid grid-cols-9 gap-3">
      {CATEGORY_ICON_NAMES.map((name) => (
        <CategoryIcon key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};

/** Every colour of the palette, on a block and on the page. */
export const EveryColour: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(["bg-card", "bg-background"] as const).map((surface) => (
        <div key={surface} className={cn("flex flex-wrap gap-3 rounded-lg p-3", surface)}>
          {PALETTE_COLORS.map((color) => (
            <CategoryIcon key={color} icon="groceries" color={color} label={color} />
          ))}
        </div>
      ))}
    </div>
  ),
};

/** In rows, beside the name. */
export const InRows: Story = {
  render: () => (
    <ul className="flex max-w-xs flex-col gap-2">
      {CATEGORIES.slice(0, 4).map((category, index) => (
        <li key={category.id} className="flex items-center gap-3 text-sm">
          <CategoryIcon icon={category.icon} color={PALETTE_COLORS[index] ?? null} size="sm" />
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
    <div className="grid grid-cols-6 gap-3">
      {CATEGORY_ICON_NAMES.map((name) => (
        <CategoryIcon key={name} icon={name} label={name} />
      ))}
    </div>
  ),
};
