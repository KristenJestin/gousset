import type { Meta, StoryObj } from "@storybook/react-vite";

import { MERCHANTS } from "../stories/made-up";
import { Button } from "./button";
import { Sheet } from "./sheet";

function Filters() {
  return (
    <Sheet
      trigger={<Button variant="secondary">Filters</Button>}
      title="Filters"
      description="Show only the lines of these merchants."
      actions={<Button>Show the lines</Button>}
    >
      <ul className="flex flex-col gap-2">
        {MERCHANTS.map((merchant) => (
          <li key={merchant.id}>{merchant.name}</li>
        ))}
      </ul>
    </Sheet>
  );
}

/**
 * A panel over the page, on ui-sdk's `Drawer`: from the right on a wide screen (from 768 px), from
 * the bottom on a phone, where it can be dragged down to close. For a line's detail or the
 * filters. Modal: focus stays inside; Escape, the close button, a press outside or a swipe closes
 * it, and focus returns to what opened it.
 *
 * Motion: it slides in from its edge with ui-sdk's short spring (about 300 ms) while the page
 * behind veils; under reduced motion it fades instead of sliding.
 *
 * Don't: stack a sheet on a sheet, use it for a question to answer (that is an `AlertDialog`), or
 * put the page's main content in it.
 */
const meta = {
  title: "Overlays/Sheet",
  component: Filters,
} satisfies Meta<typeof Filters>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** On a phone, it rises from the bottom. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
