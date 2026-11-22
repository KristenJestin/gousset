import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Dialog } from "./dialog";

/**
 * A modal dialog for a short task or a piece of help: the shortcuts list, the search. It opens
 * with a fade and a slight growth (150 ms), cut under reduced motion. Escape and its close button
 * close it.
 *
 * Don't: put a form of several steps in it (a page does that), open one dialog from another, or
 * give it a style of its own from a page.
 */
const meta = {
  title: "Overlays/Dialog",
  component: Dialog,
  args: {
    open: true,
    onClose: () => undefined,
    title: "Keyboard shortcuts",
    closeLabel: "Close",
  },
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Open, with a title and a body. */
export const Open: Story = {
  args: {
    children: "The dialog's content.",
  },
};

/** With a sentence under the title and no body, as the search shows it while it is empty. */
export const WithDescription: Story = {
  args: {
    title: "Search",
    description: "Nothing to search yet.",
  },
};

/** Opened and closed by a button, to see its motion. */
export const Toggled: Story = {
  render: function Toggled(args) {
    const [open, setOpen] = useState(false);

    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog {...args} open={open} onClose={() => setOpen(false)} />
      </>
    );
  },
};
