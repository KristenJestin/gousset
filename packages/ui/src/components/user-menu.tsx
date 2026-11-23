import { MenuGroup, MenuGroupLabel } from "@ui-sdk/react/menu";
import type { ReactNode } from "react";

import { NavButton } from "./app-shell";
import { Menu, MenuSeparator } from "./menu";

export type UserMenuProps = {
  /** Who is signed in: the trigger's words, and the menu's heading with their e-mail. */
  name: string;
  email: string;
  /** The account's few actions: the settings, the keyboard shortcuts, sign out. */
  children: ReactNode;
};

/**
 * The user's menu at the sidebar's foot: who is signed in, then the account's few actions. What
 * can be set (the language, the colour scheme, the password) lives in the settings, not here.
 * Motion: as `Menu`.
 */
export function UserMenu({ name, email, children }: UserMenuProps) {
  return (
    <Menu trigger={<NavButton icon="user" label={name} />} align="start">
      <UserMenuAccount name={name} email={email}>
        {children}
      </UserMenuAccount>
    </Menu>
  );
}

/**
 * The account's part of a menu, the user's menu or the phone's "More": a group named by who is
 * signed in (their name and e-mail at its top, never a focus stop), holding their actions.
 */
export function UserMenuAccount({ name, email, children }: UserMenuProps) {
  return (
    <MenuGroup>
      <MenuGroupLabel className="flex min-w-0 flex-col px-2 py-1.5">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{email}</span>
      </MenuGroupLabel>
      <MenuSeparator />
      {children}
    </MenuGroup>
  );
}
