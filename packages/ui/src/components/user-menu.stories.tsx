import type { Meta, StoryObj } from "@storybook/react-vite";

import { MenuItem } from "./menu";
import { UserMenu } from "./user-menu";

function Account() {
  return (
    <div className="w-56">
      <UserMenu name="Ada Example" email="ada@example.com">
        <MenuItem icon="settings">Settings</MenuItem>
        <MenuItem icon="shortcuts">Keyboard shortcuts</MenuItem>
        <MenuItem icon="signOut">Sign out</MenuItem>
      </UserMenu>
    </div>
  );
}

/**
 * The user's menu at the sidebar's foot, opened from their name: their name and e-mail at its top,
 * then the account's few actions (Settings, Keyboard shortcuts, Sign out). The phone's "More" ends
 * with the same group (`UserMenuAccount`). Motion: as `Menu`, 150 ms; cut under reduced motion.
 *
 * Don't: put the screens in it (they are the sidebar's), or anything that can be set: the
 * language, the colour scheme and the password are in the settings.
 */
const meta = {
  title: "Layout/User menu",
  component: Account,
} satisfies Meta<typeof Account>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
