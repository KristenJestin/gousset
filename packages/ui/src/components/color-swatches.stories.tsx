import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { automaticColorOf } from "../lib/palette";
import type { PaletteColor } from "../lib/palette";
import { InFrench } from "../stories/in-french";
import { Avatar } from "./avatar";
import { ColorSwatches } from "./color-swatches";
import type { ColorSwatchesProps } from "./color-swatches";

const NAME = "Corner Bistro";

/** The swatches, the avatar they colour, and the choice written out, so a test can read it. */
function Choosing({ props }: { props: ColorSwatchesProps }) {
  const [color, setColor] = useState<PaletteColor | null>(props.value);

  return (
    <div className="flex max-w-md flex-col gap-4">
      <ColorSwatches {...props} value={color} onChange={setColor} />
      <div className="flex items-center gap-3 text-sm">
        <Avatar name={NAME} color={color} size="lg" />
        <span data-testid="chosen" className="text-muted-foreground">
          {color ?? "automatic"}
        </span>
      </div>
    </div>
  );
}

/**
 * Picks a colour from the fixed palette, the same twelve keys core stores: for an avatar's
 * initials (a merchant's; a category's, later). A radio group: one tab stop, the arrow keys move
 * and choose, each swatch named for screen readers, the chosen one marked with a check. With
 * `automatic`, "Automatic" comes first, with a dot of the colour the name gets until one is
 * picked; choosing it gives `null`. Every colour keeps its initials at 4.5:1 or more in light and
 * in dark (`contrast.test.ts`). The swatches wrap on a narrow screen.
 *
 * Motion: none of its own; a swatch's check shows at once.
 *
 * Don't: offer colours outside the palette, or use a colour for a money role or a state.
 */
const meta = {
  title: "Forms/ColorSwatches",
  component: ColorSwatches,
  args: {
    label: "Colour",
    value: null,
    automatic: automaticColorOf(NAME),
    onChange: () => undefined,
  },
  render: (args) => <Choosing props={args} />,
} satisfies Meta<typeof ColorSwatches>;

export default meta;

type Story = StoryObj<typeof meta>;

/** No colour picked yet: "Automatic" is chosen. */
export const Default: Story = {};

/** A colour picked. */
export const Chosen: Story = { args: { value: "violet" } };

/** No automatic choice: a colour of the palette is always chosen. */
export const WithoutAutomatic: Story = { args: { automatic: undefined, value: "teal" } };

/** While the form is sent. */
export const Disabled: Story = { args: { value: "amber", disabled: true } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { value: "green" },
};

/** On a French page: the automatic choice and the colours' names in French. */
export const French: Story = {
  args: { label: "Couleur" },
  render: (args) => (
    <InFrench>
      <Choosing props={args} />
    </InFrench>
  ),
};
