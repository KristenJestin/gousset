import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { Tooltip } from "./tooltip";

/**
 * A short hint on a control that already has a name: it adds to it, it does not name it. It opens
 * when the pointer rests on the control (about 600 ms) and at once on keyboard focus; Escape
 * closes it and focus stays. Along a toolbar, the next one opens at once. An icon-only button is
 * `IconButton`, whose required label is its tooltip.
 *
 * Motion: it fades and grows out of its control in 150 ms, ease-out, and leaves the same way; one
 * that opens at once along a toolbar skips it. Cut under reduced motion.
 *
 * Don't: put anything a person needs in it (touch screens have no hover), a link or a button
 * (it cannot be focused), or more than a few words.
 */
const meta = {
  title: "Overlays/Tooltip",
  component: Tooltip,
  args: {
    text: "Lines you have not checked yet",
    children: <Button variant="secondary">To review</Button>,
  },
} satisfies Meta<typeof Tooltip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Below its control, when the space above is taken. */
export const Bottom: Story = { args: { side: "bottom" } };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
