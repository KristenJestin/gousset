// The classes the overlays share (tooltip, popover, menu, dialog, sheet): one surface on the
// theme's popover colours, with a soft shadow and no border (docs/design.md, "Surfaces"), and
// their entry and exit in CSS from ui-sdk's `data-starting-style` / `data-ending-style`. Reduced
// motion cuts every transition globally (`globals.css`).

/** A tooltip: small, fading and growing out of its trigger in 150 ms; at once along a toolbar. */
export const tooltipClasses =
  "max-w-64 rounded-lg bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md " +
  "origin-(--transform-origin) transition duration-150 ease-out " +
  "data-starting-style:scale-95 data-starting-style:opacity-0 " +
  "data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none";

/** A popover or a menu: fading and growing out of its trigger in 150 ms, ease-out. */
export const popupClasses =
  "rounded-lg border-0 bg-popover text-popover-foreground shadow-lg outline-none " +
  "origin-(--transform-origin) transition duration-150 ease-out " +
  "data-starting-style:scale-95 data-starting-style:opacity-0 " +
  "data-ending-style:scale-95 data-ending-style:opacity-0";

/**
 * A dialog: centred, 16 px from the screen's edges at most, fading and growing in 200 ms,
 * ease-out, and leaving the same way. On a phone (below Tailwind's `md`, where the app's tab bar
 * shows) a sheet: along the bottom edge, its whole width, its top corners rounded, sliding up
 * from that edge in 200 ms and back down.
 */
export const dialogClasses =
  "fixed inset-4 m-auto flex h-fit max-h-full w-auto max-w-md flex-col overflow-y-auto " +
  "rounded-lg border-0 bg-popover p-6 text-popover-foreground shadow-xl outline-none " +
  "transition duration-200 ease-out " +
  "data-starting-style:scale-95 data-starting-style:opacity-0 " +
  "data-ending-style:scale-95 data-ending-style:opacity-0 " +
  "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:mx-0 max-md:mb-0 " +
  "max-md:max-h-11/12 max-md:max-w-none max-md:rounded-b-none " +
  "max-md:data-starting-style:translate-y-full max-md:data-starting-style:scale-100 " +
  "max-md:data-ending-style:translate-y-full max-md:data-ending-style:scale-100";

/** The page behind a dialog or a sheet, veiled in the background's colour, fading in 200 ms. */
export const backdropClasses =
  "fixed inset-0 bg-background/70 transition-opacity duration-200 ease-out " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0";
