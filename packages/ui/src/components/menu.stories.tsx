import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Menu, MenuItem, MenuSeparator } from "./menu";

/** A line's actions, the last one chosen written below so it can be seen to run. */
function LineActions({ align = "start" }: { align?: "start" | "end" }) {
  const [chosen, setChosen] = useState("nothing yet");

  return (
    <div className="flex flex-col items-start gap-3">
      <Menu
        trigger={<IconButton icon="more" label="Actions on Greenmarket" />}
        onAction={(value) => setChosen(value)}
        align={align}
      >
        <MenuItem value="edit" icon="edit">
          Edit
        </MenuItem>
        <MenuItem value="split" icon="transfer">
          Split
        </MenuItem>
        <MenuItem value="review" icon="check" disabled>
          Mark as reviewed
        </MenuItem>
        <MenuSeparator />
        <MenuItem value="delete" icon="delete" destructive>
          Delete
        </MenuItem>
      </Menu>
      <p className="text-sm text-muted-foreground">Chosen: {chosen}</p>
    </div>
  );
}

function WithButton() {
  const [chosen, setChosen] = useState("nothing yet");

  return (
    <div className="flex flex-col items-start gap-3">
      <Menu
        trigger={
          <Button variant="secondary" icon="import">
            Import
          </Button>
        }
        onAction={(value) => setChosen(value)}
      >
        <MenuItem value="csv">A CSV statement</MenuItem>
        <MenuItem value="ofx">An OFX statement</MenuItem>
        <MenuItem value="pdf" disabled>
          A PDF statement
        </MenuItem>
      </Menu>
      <p className="text-sm text-muted-foreground">Chosen: {chosen}</p>
    </div>
  );
}

/**
 * A list of actions opened from a button: a line's "More actions", an import's choices. Items
 * take an optional icon; a `destructive` item (Delete) is drawn in the destructive colour, after
 * a separator; a disabled item is still reached with the arrow keys and does nothing. Arrow keys
 * move, Enter runs the item, typing jumps to it, Escape closes the menu and focus returns to the
 * trigger.
 *
 * Motion: the menu fades and grows out of its trigger in 150 ms, ease-out, and leaves the same
 * way. Cut under reduced motion.
 *
 * Don't: put a form or anything but actions in it (that is a `Popover`), choose a value with it
 * in a form (that is a select), or hide the only way to do something important behind it.
 */
const meta = {
  title: "Overlays/Menu",
  component: LineActions,
} satisfies Meta<typeof LineActions>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** At a row's right edge: lined up with the trigger's end. */
export const AlignedToTheEnd: Story = {
  args: { align: "end" },
  render: (args) => (
    <div className="flex justify-end">
      <LineActions {...args} />
    </div>
  ),
};

/** Opened from a `Button` with a label. */
export const FromAButton: Story = { render: () => <WithButton /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
