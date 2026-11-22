import {
  Tabs as TabsRoot,
  TabsIndicator,
  TabsList as TabsListPart,
  TabsPanel as TabsPanelPart,
  TabsTab,
} from "@ui-sdk/react/tabs";
import type { ReactNode } from "react";

import { Icon } from "./icon";
import type { IconName } from "./icon";

export type TabsProps = {
  children: ReactNode;
  /** The selected tab, to control it; leave it out and `defaultValue` (or the first tab) starts. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};

/**
 * Views that share one place, one shown at a time, on ui-sdk's `Tabs`: a `TabsList` of `Tab`s,
 * then a `TabsPanel` for each. Arrow keys move between the tabs and show their panel.
 *
 * Motion: the selected tab's background slides to the newly chosen one in 200 ms, ease-out; its
 * first placement does not move. Cut under reduced motion.
 */
export function Tabs({ children, value, defaultValue, onValueChange }: TabsProps) {
  return (
    <TabsRoot
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (next !== null) {
          onValueChange?.(next);
        }
      }}
      className="flex flex-col gap-3"
    >
      {children}
    </TabsRoot>
  );
}

export type TabsListProps = {
  /** What the tabs choose between, for screen readers ("Where the money goes"). */
  label: string;
  children: ReactNode;
};

/** The row of tabs: a compact segmented control, its selection sliding from tab to tab. */
export function TabsList({ label, children }: TabsListProps) {
  return (
    <TabsListPart
      aria-label={label}
      className="relative inline-flex w-fit items-center rounded-lg bg-muted p-0.5"
    >
      <TabsIndicator className="absolute top-(--active-tab-top) left-(--active-tab-left) h-(--active-tab-height) w-(--active-tab-width) rounded-md bg-card shadow-sm transition-all duration-200 ease-out data-[activation-direction=none]:transition-none" />
      {children}
    </TabsListPart>
  );
}

export type TabProps = {
  /** Pairs the tab with the `TabsPanel` of the same value. */
  value: string;
  children: ReactNode;
  /** A decorative icon before the label. */
  icon?: IconName;
  /** Still reachable with the arrow keys, but it cannot be selected. */
  disabled?: boolean;
};

export function Tab({ value, children, icon, disabled = false }: TabProps) {
  return (
    <TabsTab
      value={value}
      disabled={disabled}
      className="relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 ease-out select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:text-muted-foreground data-selected:text-foreground"
    >
      {icon === undefined ? null : <Icon name={icon} size="sm" />}
      {children}
    </TabsTab>
  );
}

export type TabsPanelProps = {
  /** The value of the tab it belongs to. */
  value: string;
  children: ReactNode;
};

export function TabsPanel({ value, children }: TabsPanelProps) {
  return (
    <TabsPanelPart
      value={value}
      className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </TabsPanelPart>
  );
}
