import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Popover } from "./popover";

/**
 * Rich content in a floating panel opened from a button: a short detail, a few fields, a link.
 * Its `title` names it. Focus moves into it on open; Escape, a press outside or focus leaving
 * closes it, and focus returns to the trigger.
 *
 * Motion: it fades and grows out of its trigger in 150 ms, ease-out, and leaves the same way. Cut
 * under reduced motion.
 *
 * Don't: put a list of actions in it (that is a `Menu`), a long form or a task with steps (that is
 * a `Dialog` or a `Sheet`), or open a popover from inside another.
 */
const meta = {
  title: "Overlays/Popover",
  component: Popover,
  args: {
    trigger: <Button variant="secondary">How is this counted?</Button>,
    title: "Left this month",
    children: (
      <p className="text-muted-foreground">
        What came in, minus what was spent and what was set aside. Transfers between your own
        accounts are not counted.
      </p>
    ),
  },
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Opened from an icon button, with a button inside that focus reaches first. */
export const WithAction: Story = {
  args: {
    trigger: <IconButton icon="info" label="About Greenmarket" variant="secondary" />,
    title: "Greenmarket",
    children: (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">9 visits this month, groceries.</p>
        <Button size="sm" variant="secondary">
          See every line
        </Button>
      </div>
    ),
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
