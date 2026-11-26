import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { PaletteColor } from "../lib/palette";
import { InFrench } from "../stories/in-french";
import { CategoryIconChoice } from "./category-icon-choice";
import type { CategoryIconName } from "./icons";

/** The grid, with the icon chosen written under it so it can be seen to change. */
function Choosing({
  initial,
  color,
  disabled,
}: {
  initial: CategoryIconName | null;
  color?: PaletteColor | null;
  disabled?: boolean;
}) {
  const [chosen, setChosen] = useState(initial);

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-lg border bg-popover p-4">
      <CategoryIconChoice
        label="Icon"
        value={chosen}
        onChange={setChosen}
        color={color}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        Chosen: {chosen ?? "none"}
      </p>
    </div>
  );
}

/**
 * A category's icon (#205), among those `icons.ts` offers, in their order: a grid of tiles in a
 * radio group (Tab reaches it, the arrow keys move through it), each named by what it means. The
 * chosen one is drawn as it will be shown: on a tile of the category's colour (`color`), or a
 * neutral one, and ringed.
 *
 * Motion: the tiles' colours change in 150 ms, ease-out. Cut under reduced motion.
 *
 * Don't: offer an emoji, or a drawing from outside `icons.ts`.
 */
const meta = {
  title: "Forms/CategoryIconChoice",
  component: Choosing,
  args: { initial: "groceries", color: "green" },
} satisfies Meta<typeof Choosing>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No colour: the chosen icon on a neutral tile. */
export const Neutral: Story = { args: { color: null } };

/** Nothing chosen yet. */
export const NoneYet: Story = { args: { initial: null } };

export const Disabled: Story = { args: { disabled: true } };

export const French: Story = {
  render: () => (
    <InFrench>
      <Choosing initial="bakery" color="amber" />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
