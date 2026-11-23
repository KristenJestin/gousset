// The look the form controls share (TextField, Select, Combobox, DatePicker), set once here.
import { floatingSurfaceClasses } from "./overlay-classes";
import { cn } from "./utils";

/** The surface of every control that holds a value: input, select, combobox, date. */
export function controlClasses(size: "md" | "sm") {
  return cn(
    "flex w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card text-sm text-foreground",
    "transition-colors duration-150 ease-out",
    "placeholder:text-muted-foreground",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50",
    // Invalid: the control itself, or the `Field` around it (`FormField`'s `group/field`).
    "aria-invalid:border-destructive data-invalid:border-destructive group-data-invalid/field:border-destructive",
    size === "md" && "h-9 px-3",
    size === "sm" && "h-8 px-2.5",
  );
}

/** The focus ring of a control. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The focus ring of a group around an input and its button (a combobox, a date): a text input
 * shows its ring whatever moved the focus, so `focus-within` is the same as the input's own.
 */
export const groupFocusRing =
  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring";

/**
 * A popup's surface (a select's list, a combobox's, a calendar): the floating surface, entering
 * and leaving with a short fade and a slight scale from where it opens (150 ms, ease-out).
 */
export const popupClasses = cn(
  "m-0 rounded-lg p-1 text-sm",
  floatingSurfaceClasses,
  "origin-(--transform-origin) transition duration-150 ease-out",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0",
);

/** A row of a popup's list. */
export const itemClasses = cn(
  "flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none",
  "data-highlighted:bg-muted data-selected:font-medium",
  "data-disabled:cursor-not-allowed data-disabled:opacity-50",
);
