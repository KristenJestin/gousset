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
  "rounded-lg bg-popover text-popover-foreground shadow-lg outline-none " +
  "origin-(--transform-origin) transition duration-150 ease-out " +
  "data-starting-style:scale-95 data-starting-style:opacity-0 " +
  "data-ending-style:scale-95 data-ending-style:opacity-0";

/** The page behind a dialog or a sheet, veiled in the background's colour, fading in 200 ms. */
export const backdropClasses =
  "fixed inset-0 bg-background/70 transition-opacity duration-200 ease-out " +
  "data-starting-style:opacity-0 data-ending-style:opacity-0";
