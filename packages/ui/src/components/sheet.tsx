import {
  Dialog as DialogRoot,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { useSyncExternalStore } from "react";
import type { FormEvent, ReactElement, ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { backdropClasses, sheetClasses } from "../lib/overlay-classes";
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

/**
 * A form's first field, where focus starts (ui-sdk's `initialFocus` looks a selector up inside the
 * sheet); the native inputs ui-sdk hides behind a select or a switch (`tabindex="-1"`) left out.
 */
const FIRST_FIELD =
  '[data-slot="sheet-body"] :is(input, textarea, select, button):not([disabled], [tabindex="-1"], [type="hidden"])';

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
   * or by Enter in a field, and Cancel comes before the actions. Focus starts on its first field.
   * The sheet stays open until the page closes it (`open`), so that a refusal shows under its field.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** With `onSubmit`: something was typed in the form (to take a refusal away). */
  onInput?: () => void;
  /**
   * With `onSubmit`: the form is being sent. Nothing closes the sheet meanwhile (a press on the
   * backdrop, Escape, the close button, Cancel), so that the answer lands on the form that sent it.
   */
  sending?: boolean;
  /** The element that opens it, forwarding its props and ref (a `Button`); or control `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A panel over the page, on ui-sdk's `Dialog`: from the right on a wide screen, from the bottom on
 * a phone. A line's detail, a filter, a long form (`onSubmit`). Modal: focus stays inside, the page
 * behind is dimmed by the backdrop; Escape, the close button or a press on the backdrop closes it
 * (not while its form is `sending`), and focus returns to what opened it.
 *
 * Its body scrolls between the header and the actions, its padding inside the scroller, so that a
 * focused field's ring is never clipped (#122).
 *
 * Motion: it slides in from its edge in 300 ms, ease-out, and back out in 200 ms, ease-in, while
 * the backdrop fades in and out in 200 ms. Cut under reduced motion: it is there, or not.
 */
export function Sheet({
  title,
  description,
  children,
  actions,
  onSubmit,
  onInput,
  sending = false,
  trigger,
  open,
  onOpenChange,
}: SheetProps) {
  const wide = useWideScreen();

  const body = (
    <>
      {children === undefined ? null : (
        <div
          data-slot="sheet-body"
          className={cn(
            // At least 4 px around every field inside the scroller, and as much kept when a field
            // is scrolled into view: room for its ring (2 px, 2 px away), never clipped (#122).
            "min-h-0 flex-1 scroll-py-1 overflow-y-auto px-4 pt-1 pb-4 text-sm md:px-6 md:pb-6",
            onSubmit !== undefined && "flex flex-col gap-5",
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
          <CancelButton disabled={sending} />
          {actions}
        </SheetActions>
      )}
    </>
  );

  return (
    <DialogRoot open={open} dismissible={!sending} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger === undefined ? null : <DialogTrigger render={trigger} />}
      <DialogBackdrop className={backdropClasses} />
      {/* A form starts on its first field; otherwise focus starts on the sheet itself, reading
          from the title, and Escape closes it at once (on the close button, its tooltip would
          take the first Escape). */}
      <DialogContent
        initialFocus={onSubmit === undefined ? "content" : FIRST_FIELD}
        data-side={wide ? "right" : "bottom"}
        className={sheetClasses}
      >
        <SheetHeader title={title} description={description} sending={sending} />
        {onSubmit === undefined ? (
          body
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={onSubmit}
            onInput={() => onInput?.()}
          >
            {body}
          </form>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

/** A form sheet's Cancel, in the page's language: closes it, sending nothing. */
function CancelButton({ disabled }: { disabled: boolean }) {
  const messages = useUiMessages();

  return (
    <DialogClose
      render={
        <Button variant="ghost" disabled={disabled}>
          {messages.overlays.cancel}
        </Button>
      }
    />
  );
}

/** Cancel, then the actions, at the right under a rule; on a phone stacked, the main one on top. */
function SheetActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col-reverse gap-2 border-t px-4 pt-3 pb-4 md:flex-row md:justify-end md:px-6 md:py-4">
      {children}
    </div>
  );
}

function SheetHeader({
  title,
  description,
  sending,
}: {
  title: string;
  description?: string;
  sending: boolean;
}) {
  const messages = useUiMessages();

  return (
    <div className="flex shrink-0 items-start gap-3 px-4 pt-5 pb-3 md:px-6 md:pb-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        {description === undefined ? null : (
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        )}
      </div>
      <DialogClose
        render={
          <IconButton icon="close" label={messages.overlays.close} size="sm" disabled={sending} />
        }
      />
    </div>
  );
}
