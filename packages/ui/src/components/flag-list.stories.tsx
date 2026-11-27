import type { Meta, StoryObj } from "@storybook/react-vite";

import { MADE_UP_LOGO } from "../stories/made-up";
import { FlagList, FlagListSkeleton } from "./flag-list";

/**
 * What the review points out (screen 1, block 6): a subscription whose price changed, an account
 * not imported up to date. One sentence each, written by the page, after an icon of its kind.
 *
 * Loading: `FlagListSkeleton`, two rows by default, same heights.
 *
 * Motion: none of its own.
 *
 * Don't: colour a flag as an error; it is something to look at, not a failure.
 */
const meta = {
  title: "Data/Flag list",
  component: FlagList,
  args: {
    flags: [
      { id: "streamly", icon: "subscriptions", text: "Streamly goes from €8.99 to €9.49" },
      { id: "mealcard", icon: "import", text: "MealCard: imported up to 24 Oct" },
    ],
    label: "Flagged",
    emptyText: "Nothing to point out this month.",
  },
} satisfies Meta<typeof FlagList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * A flag about a subscription shows its merchant's face after the icon (#204): its logo, or its
 * initials on its colour; a flag about an account has none.
 */
export const WithAvatars: Story = {
  args: {
    flags: [
      {
        id: "streamly",
        icon: "up",
        text: "Streamly goes from €8.99 to €9.49",
        avatar: { name: "Streamly", color: "red" },
      },
      {
        id: "greenmarket",
        icon: "error",
        text: "Greenmarket box, due on 12 Oct, did not come (last €24.90 on 12 Sept)",
        avatar: { name: "Greenmarket", src: MADE_UP_LOGO },
      },
      { id: "mealcard", icon: "import", text: "MealCard: imported up to 24 Oct" },
    ],
  },
};

export const WithAvatarsOnPhone: Story = {
  ...WithAvatars,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const Empty: Story = { args: { flags: [] } };

export const Loading: Story = { render: () => <FlagListSkeleton /> };

export const Phone: Story = { globals: { viewport: { value: "mobile1", isRotated: false } } };
