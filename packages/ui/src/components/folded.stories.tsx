import type { Meta, StoryObj } from "@storybook/react-vite";

import { Block } from "./data-block";
import { FlagList } from "./flag-list";
import { Folded } from "./folded";

const FLAGS = (
  <FlagList
    flags={[
      { id: "streamly", icon: "subscriptions", text: "Streamly goes from €8.99 to €9.49" },
      { id: "mealcard", icon: "import", text: "MealCard: imported up to 24 Oct" },
    ]}
    label="Flagged"
    emptyText="Nothing to point out this month."
  />
);

/**
 * A secondary block of a page, folded on a phone (screen 11): one line with its title, a summary
 * and a chevron, that opens the content in a sheet. From a tablet up, the content as it is. It
 * goes inside a `Block` with `foldOnPhone`, which leaves it the title.
 *
 * Motion: the sheet's own: it slides up from the bottom (about 300 ms), and fades under reduced
 * motion.
 *
 * Don't: fold the page's main block, or put a second fold inside the sheet.
 */
const meta = {
  title: "Layout/Folded",
  component: Folded,
  args: { title: "Flagged", summary: "2", children: FLAGS },
  render: (args) => (
    <div className="max-w-md">
      <Block title={args.title} foldOnPhone>
        <Folded {...args} />
      </Block>
    </div>
  ),
} satisfies Meta<typeof Folded>;

export default meta;

type Story = StoryObj<typeof meta>;

/** On a wide screen: the content in its block. */
export const Default: Story = {};

/** On a phone: one line, which opens the content in a sheet. */
export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
