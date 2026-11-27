import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import type { PaletteColor } from "../lib/palette";
import { InFrench } from "../stories/in-french";
import { ColorSwatches } from "./color-swatches";

/** The swatches, with the colour chosen written under them so it can be seen to change. */
function Choosing({
  initial,
  noneLabel,
  noneColor,
  disabled,
}: {
  initial: PaletteColor | null;
  noneLabel?: string;
  noneColor?: PaletteColor | null;
  disabled?: boolean;
}) {
  const [chosen, setChosen] = useState(initial);

  return (
    <div className="flex max-w-sm flex-col gap-3 rounded-lg border bg-popover p-4">
      <ColorSwatches
        label="Colour"
        value={chosen}
        onChange={setChosen}
        noneLabel={noneLabel}
        noneColor={noneColor}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground" data-testid="chosen">
        Chosen: {chosen ?? "none"}
      </p>
    </div>
  );
}

/**
 * One colour of the palette (`--palette-<key>`), the colours a user tints their own data with: a
 * category's colour (#205), and whatever else the user colours (a merchant's avatar). Round
 * swatches in a radio group: Tab reaches the group, the arrow keys move through it, each swatch is
 * named by its colour's name. The chosen one is ringed and checked. With `noneLabel`, no colour
 * comes first: a dashed swatch, or the colour it stands for (a child's parent's), faded. Every
 * colour holds 4.5:1 or more on the page, the blocks, a muted band and its own tile, in both
 * schemes ("Theme/Tokens" lists the figures).
 *
 * Motion: the ring and the check of the chosen swatch fade in 150 ms, ease-out. Cut under reduced
 * motion.
 *
 * Don't: build a colour picker of free colours, or tint with a colour outside the palette: the
 * palette is what holds its contrast.
 */
const meta = {
  title: "Forms/ColorSwatches",
  component: Choosing,
  args: { initial: "green" },
} satisfies Meta<typeof Choosing>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** No colour may be chosen: a dashed swatch first. */
export const WithNone: Story = { args: { initial: null, noneLabel: "No colour" } };

/** A child's choice: none stands for its parent's colour, shown faded. */
export const ParentsColour: Story = {
  args: { initial: null, noneLabel: "As Housing", noneColor: "blue" },
};

export const Disabled: Story = { args: { disabled: true } };

/** On dark whatever the page's scheme: every swatch, and its check, still reads. */
export const OnDark: Story = {
  render: (args) => (
    <div data-color-scheme="dark" className="w-fit bg-background p-6">
      <Choosing {...args} />
    </div>
  ),
};

export const French: Story = {
  render: () => (
    <InFrench>
      <Choosing initial="teal" noneLabel="Sans couleur" />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  args: { noneLabel: "No colour" },
};
