import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { cn } from "../lib/utils";
import { IconButton } from "./icon-button";

// Tailwind's `md`: from there the sheet comes from the right, below it from the bottom.
const WIDE = "(min-width: 48rem)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(WIDE);

  media.addEventListener("change", onChange);

  return () => media.removeEventListener("change", onChange);
}

/** Whether the screen is wide enough for a side sheet; a wide screen on the server. */
function useWideScreen() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export type SheetProps = {
  /** Names the sheet, at its top. */
  title: string;
  /** A sentence under the title saying what the sheet is for. */
  description?: string;
  /** The body; it scrolls when long. */
  children?: ReactNode;
  /** `Button`s at the bottom, the main one last. */
  actions?: ReactNode;
  /** The element that opens it, forwarding its props and ref (a `Button`); or control `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A panel over the page, on ui-sdk's `Drawer`: from the right on a wide screen, from the bottom
 * on a phone, where it can be dragged down to close. A line's detail, a filter. Modal: focus stays
 * inside; Escape, the close button, a press outside or a swipe closes it, and focus returns to
 * what opened it.
 *
 * Motion: ui-sdk slides it in from its edge with a short spring (about 300 ms) and dims the page
 * with it; under reduced motion it fades instead of sliding.
 */
export function Sheet({
  title,
  description,
  children,
  actions,
  trigger,
  open,
  onOpenChange,
}: SheetProps) {
  const wide = useWideScreen();

  return (
    <Drawer
      side={wide ? "right" : "bottom"}
      open={open}
      onOpenChange={(next) => onOpenChange?.(next)}
    >
      {trigger === undefined ? null : <DrawerTrigger render={trigger} />}
      <DrawerBackdrop className="bg-background/70" />
      <DrawerContent
        className={cn(
          "flex flex-col gap-4 bg-popover p-6 text-popover-foreground shadow-xl outline-none",
          wide ? "h-full w-96 max-w-full rounded-l-lg" : "max-h-full w-full rounded-t-lg",
        )}
      >
        <SheetHeader title={title} description={description} />
        {children === undefined ? null : (
          <div className="min-h-0 flex-1 overflow-y-auto text-sm">{children}</div>
        )}
        {actions === undefined ? null : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SheetHeader({ title, description }: { title: string; description?: string }) {
  const messages = useUiMessages();

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <DrawerTitle className="text-base font-semibold">{title}</DrawerTitle>
        {description === undefined ? null : (
          <DrawerDescription className="text-sm text-muted-foreground">
            {description}
          </DrawerDescription>
        )}
      </div>
      <DrawerClose render={<IconButton icon="close" label={messages.overlays.close} size="sm" />} />
    </div>
  );
}
