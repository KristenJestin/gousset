// The classes the overlays share (tooltip, popover, menu, dialog, sheet): one floating surface on
// the theme's popover colours, set off from the page by its own edge and shadow
// (`--popover-border`, `--popover-shadow`; docs/design.md, "Floating surfaces"), and their entry
// and exit in CSS from ui-sdk's `data-starting-style` / `data-ending-style`. Reduced motion cuts
// every transition globally (`globals.css`).
import { cn } from "./utils";

/** The surface every floating element shares: its colours, its edge and its shadow. */
export const floatingSurfaceClasses =
  "border border-popover-border bg-popover text-popover-foreground shadow-popover";

/** A tooltip: small, fading and growing out of its trigger in 150 ms; at once along a toolbar. */
export const tooltipClasses = cn(
  "max-w-64 rounded-lg px-2 py-1 text-xs",
  floatingSurfaceClasses,
  "origin-(--transform-origin) transition duration-150 ease-out",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none",
);

/** A popover or a menu: fading and growing out of its trigger in 150 ms, ease-out. */
export const popupClasses = cn(
  "rounded-lg outline-none",
  floatingSurfaceClasses,
  "origin-(--transform-origin) transition duration-150 ease-out",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0",
);

/**
 * A dialog: centred, 16 px from the screen's edges at most, fading and growing in 200 ms,
 * ease-out, and leaving the same way. On a phone (below Tailwind's `md`, where the app's tab bar
 * shows) a sheet: along the bottom edge, its whole width, its top corners rounded, sliding up
 * from that edge in 200 ms and back down; its edge then shows only on the side facing the page.
 */
export const dialogClasses = cn(
  "fixed inset-4 m-auto flex h-fit max-h-full w-auto max-w-md flex-col overflow-y-auto",
  "rounded-lg p-6 outline-none",
  floatingSurfaceClasses,
  "transition duration-200 ease-out",
  "data-starting-style:scale-95 data-starting-style:opacity-0",
  "data-ending-style:scale-95 data-ending-style:opacity-0",
  "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:mx-0 max-md:mb-0",
  "max-md:max-h-11/12 max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
  "max-md:data-starting-style:translate-y-full max-md:data-starting-style:scale-100",
  "max-md:data-ending-style:translate-y-full max-md:data-ending-style:scale-100",
);

/** The page behind a dialog or a sheet, veiled in the background's colour, fading in 200 ms. */
export const backdropClasses =
  "fixed inset-0 bg-background/70 transition-opacity duration-200 ease-out " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0";
