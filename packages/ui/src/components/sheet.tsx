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
import type { FormEvent, ReactElement, ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { floatingSurfaceClasses } from "../lib/overlay-classes";
import { cn } from "../lib/utils";
import { Button } from "./button";
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
  /**
   * The sheet holds a long form (docs/design.md, "Actions and forms"): the body (its fields, one
   * under the other) and the actions are one `<form>`, sent by the submit `Button` among the actions
   * or by Enter in a field, and Cancel comes before the actions. The sheet stays open until the
   * page closes it (`open`), so that a refusal shows under its field.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** With `onSubmit`: something was typed in the form (to take a refusal away). */
  onInput?: () => void;
  /** The element that opens it, forwarding its props and ref (a `Button`); or control `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A panel over the page, on ui-sdk's `Drawer`: from the right on a wide screen, from the bottom
 * on a phone, where it can be dragged down to close. A line's detail, a filter, a long form
 * (`onSubmit`). Modal: focus stays inside; Escape, the close button, a press outside or a swipe
 * closes it, and focus returns to what opened it.
 *
 * Motion: ui-sdk slides it in from its edge with a short spring (about 300 ms) and dims the page
 * with it; under reduced motion it fades instead of sliding.
 */
export function Sheet({
  title,
  description,
  children,
  actions,
  onSubmit,
  onInput,
  trigger,
  open,
  onOpenChange,
}: SheetProps) {
  const wide = useWideScreen();

  const body = (
    <>
      {children === undefined ? null : (
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto text-sm",
            onSubmit !== undefined && "flex flex-col gap-4",
          )}
        >
          {children}
        </div>
      )}
      {onSubmit === undefined ? (
        actions === undefined ? null : (
          <SheetActions>{actions}</SheetActions>
        )
      ) : (
        <SheetActions>
          <CancelButton />
          {actions}
        </SheetActions>
      )}
    </>
  );

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
          "flex flex-col gap-4 p-6 outline-none",
          floatingSurfaceClasses,
          // The edge shows on the side that faces the page, not along the screen's own edges.
          wide
            ? "h-full w-96 max-w-full rounded-l-lg border-y-0 border-r-0"
            : "max-h-full w-full rounded-t-lg border-x-0 border-b-0",
        )}
      >
        <SheetHeader title={title} description={description} />
        {onSubmit === undefined ? (
          body
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col gap-4"
            onSubmit={onSubmit}
            onInput={() => onInput?.()}
          >
            {body}
          </form>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** A form sheet's Cancel, in the page's language: closes it, sending nothing. */
function CancelButton() {
  const messages = useUiMessages();

  return <DrawerClose render={<Button variant="secondary">{messages.overlays.cancel}</Button>} />;
}

function SheetActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
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
