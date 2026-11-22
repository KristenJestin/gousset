import {
  Menu as MenuRoot,
  MenuContent,
  MenuItem as MenuItemPart,
  MenuItemIcon,
  MenuSeparator as MenuSeparatorPart,
  MenuTrigger,
} from "@ui-sdk/react/menu";
import type { ReactElement, ReactNode } from "react";

import { popupClasses } from "../lib/overlay-classes";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import type { IconName } from "./icon";

export type MenuProps = {
  /**
   * What opens it: one element that forwards its props and ref, like an `IconButton` or a
   * `Button`. ui-sdk gives it the menu's ARIA and its keyboard (Enter, Space, the arrows).
   */
  trigger: ReactElement;
  /** `MenuItem`s, `MenuSeparator`s between their groups. */
  children: ReactNode;
  /** Runs with the `value` of the item chosen, for menus whose items share one handler. */
  onAction?: (value: string) => void;
  /** Lined up with the trigger's start (the default) or its end, as at a row's right edge. */
  align?: "start" | "end";
};

/**
 * A list of actions opened from a button, on ui-sdk's `Menu`: arrow keys move, Enter runs the
 * item, typing jumps to an item, Escape closes it and focus returns to the trigger.
 *
 * Motion: it fades and grows out of its trigger in 150 ms, ease-out, and leaves the same way. Cut
 * under reduced motion.
 */
export function Menu({ trigger, children, onAction, align = "start" }: MenuProps) {
  return (
    <MenuRoot onAction={onAction}>
      <MenuTrigger render={trigger} />
      <MenuContent align={align} sideOffset={4} className={cn(popupClasses, "min-w-44 p-1")}>
        {children}
      </MenuContent>
    </MenuRoot>
  );
}

export type MenuItemProps = {
  children: ReactNode;
  /** Passed to the menu's `onAction`. */
  value?: string;
  /** A decorative icon before the label. */
  icon?: IconName;
  /** An action that deletes or cannot be undone: drawn in the destructive colour. */
  destructive?: boolean;
  /** Still reached with the arrow keys, as the menu pattern asks, but it does nothing. */
  disabled?: boolean;
  /** Runs when the item is chosen; a promise keeps the menu open, the item busy, until it settles. */
  onSelect?: () => Promise<void> | void;
};

export function MenuItem({
  children,
  value,
  icon,
  destructive = false,
  disabled = false,
  onSelect,
}: MenuItemProps) {
  return (
    <MenuItemPart
      value={value}
      destructive={destructive}
      disabled={disabled}
      onSelect={onSelect === undefined ? undefined : () => onSelect()}
      className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-destructive:text-destructive data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-muted data-pending:cursor-progress"
    >
      {icon === undefined ? null : (
        <MenuItemIcon className="flex text-muted-foreground in-data-destructive:text-destructive">
          <Icon name={icon} />
        </MenuItemIcon>
      )}
      {children}
    </MenuItemPart>
  );
}

/** A line between groups of items; never a focus stop. */
export function MenuSeparator() {
  return <MenuSeparatorPart className="-mx-1 my-1 h-px bg-border" />;
}
