import {
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import type { ReactElement, ReactNode } from "react";

import { popupClasses } from "../lib/overlay-classes";
import { cn } from "../lib/utils";

export type PopoverProps = {
  /** What opens it: one element that forwards its props and ref, like a `Button` or an `IconButton`. */
  trigger: ReactElement;
  /** Names the popover, shown at its top. */
  title: string;
  children: ReactNode;
  /** Where it opens; it flips when there is no room. */
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Rich content in a floating panel opened from a button, on ui-sdk's `Popover`: a detail, a few
 * fields. Focus moves into it on open; Escape, a press outside or focus leaving closes it, and
 * focus returns to the trigger.
 *
 * Motion: it fades and grows out of its trigger in 150 ms, ease-out, and leaves the same way. Cut
 * under reduced motion.
 */
export function Popover({
  trigger,
  title,
  children,
  side = "bottom",
  align = "start",
  open,
  onOpenChange,
}: PopoverProps) {
  return (
    <PopoverRoot open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        className={cn(popupClasses, "flex w-72 max-w-(--available-width) flex-col gap-2 p-4")}
      >
        <PopoverTitle className="text-sm font-semibold">{title}</PopoverTitle>
        <div className="text-sm">{children}</div>
      </PopoverContent>
    </PopoverRoot>
  );
}
