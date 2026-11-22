import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShortcutList } from "./shortcut-list";

/**
 * The app's keyboard shortcuts, as the `?` dialog lists them. The page builds the list from the
 * declared shortcuts and writes the keys for the user's platform.
 *
 * Don't: write a list by hand in a page; it would drift from the shortcuts that really work.
 */
const meta = {
  title: "Help/ShortcutList",
  component: ShortcutList,
} satisfies Meta<typeof ShortcutList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** As on Windows and Linux. */
export const Default: Story = {
  args: {
    shortcuts: [
      { id: "shortcuts.show", label: "Show keyboard shortcuts", keys: "?" },
      { id: "search.open", label: "Search", keys: "Ctrl+K" },
    ],
  },
};

/** As on a Mac. */
export const Mac: Story = {
  args: {
    shortcuts: [
      { id: "shortcuts.show", label: "Show keyboard shortcuts", keys: "?" },
      { id: "search.open", label: "Search", keys: "⌘K" },
    ],
  },
};

/** No shortcut declared: an empty list, which the app never shows. */
export const Empty: Story = {
  args: { shortcuts: [] },
};
