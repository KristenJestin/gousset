import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MenuItem } from "./menu";
import { UserMenu } from "./user-menu";

function Account() {
  const [language, setLanguage] = useState<"en" | "fr">("en");

  return (
    <div className="w-56">
      <UserMenu
        name="Ada Example"
        languageLabel="Language"
        language={language}
        languages={[
          { value: "en", label: "English" },
          { value: "fr", label: "Français" },
        ]}
        onLanguageChange={setLanguage}
        colorSchemeLabel="Colour scheme"
        colorSchemes={{ system: "System", light: "Light", dark: "Dark" }}
      >
        <MenuItem icon="password">Change password</MenuItem>
        <MenuItem icon="users">Users</MenuItem>
        <MenuItem icon="signOut">Sign out</MenuItem>
      </UserMenu>
    </div>
  );
}

/**
 * The user's menu at the sidebar's foot, opened from their name: the language and the colour
 * scheme (each a ticked choice, `menuitemradio`), then the account's actions. The scheme applies
 * at once and is kept in this browser; the app keeps it on the account too
 * (`onColorSchemeChange`). Motion: as `Menu`, 150 ms; cut under reduced motion.
 *
 * Don't: put the screens in it (they are the sidebar's), or settings that need more than a tick.
 */
const meta = {
  title: "Layout/User menu",
  component: Account,
} satisfies Meta<typeof Account>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
