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
 * A dialog: centred, 16 px from the screen's edges at most, fading and growing from 96 % in 200 ms,
 * ease-out, and leaving the same way in 150 ms, ease-in. On a phone (below Tailwind's `md`, where
 * the app's tab bar shows) a sheet: along the bottom edge, its whole width, its top corners
 * rounded, rising from that edge in 300 ms, ease-out, and going back down in 200 ms, ease-in; its
 * edge then shows only on the side facing the page, its content above an installed app's home
 * indicator. It scrolls as a whole, its padding inside the
 * scroller, and keeps 4 px around a field scrolled into view, so a focused field's ring (2 px,
 * 2 px away) is never clipped (#122).
 */
export const dialogClasses = cn(
  "fixed inset-4 m-auto flex h-fit max-h-full w-auto max-w-md scroll-py-1 flex-col overflow-y-auto",
  "rounded-lg p-6 outline-none",
  floatingSurfaceClasses,
  "transition ease-out data-ending-style:ease-in",
  // A wide screen: it fades and grows.
  "md:duration-200 md:data-ending-style:duration-150",
  "md:data-starting-style:scale-96 md:data-starting-style:opacity-0",
  "md:data-ending-style:scale-96 md:data-ending-style:opacity-0",
  // A phone: it rises from the bottom edge.
  "max-md:duration-300 max-md:data-ending-style:duration-200",
  "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:mx-0 max-md:mb-0",
  "max-md:max-h-11/12 max-md:max-w-none max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
  "max-md:pb-safe-6",
  "max-md:data-starting-style:translate-y-full max-md:data-ending-style:translate-y-full",
);

/**
 * A side sheet: along the right edge, its whole height, 440 px wide, its edge on the side facing
 * the page; it slides in from beyond that edge in 300 ms, ease-out, and back out in 200 ms,
 * ease-in. On a phone a bottom sheet, as a dialog is there: its whole width, its top corners
 * rounded, rising from the bottom edge the same way, its content above an installed app's home
 * indicator. Under reduced motion it never stands off its
 * edge, not even for the first frame: it is there, or not. Its parts (`Sheet`) carry their own
 * padding, the scrolling body's inside the scroller.
 */
export const sheetClasses = cn(
  "fixed inset-y-0 right-0 flex flex-col outline-none",
  floatingSurfaceClasses,
  "transition-transform duration-300 ease-out data-ending-style:duration-200 data-ending-style:ease-in",
  // A wide screen: from the right edge.
  "md:w-110 md:max-w-full md:rounded-l-lg md:border-y-0 md:border-r-0",
  "md:motion-safe:data-starting-style:translate-x-full md:motion-safe:data-ending-style:translate-x-full",
  // A phone: from the bottom edge.
  "max-md:top-auto max-md:left-0 max-md:max-h-11/12 max-md:rounded-t-xl max-md:border-x-0 max-md:border-b-0 max-md:pb-safe",
  "max-md:motion-safe:data-starting-style:translate-y-full max-md:motion-safe:data-ending-style:translate-y-full",
);

/**
 * The page behind a dialog or a sheet, dimmed by the scrim (`--overlay`), fading in in 200 ms,
 * ease-out, and out in 200 ms, ease-in. A press on it closes what it is behind, unless a form there
 * is being sent (`Dialog`'s and `Sheet`'s `sending`).
 */
export const backdropClasses = cn(
  "fixed inset-0 bg-overlay transition-opacity duration-200 ease-out data-ending-style:ease-in",
  "data-starting-style:opacity-0 data-ending-style:opacity-0",
);
