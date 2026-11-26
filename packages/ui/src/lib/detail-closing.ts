import { createContext } from "react";

/**
 * Whether the open line's detail is on its way out: `OperationsLayout` keeps a closed detail
 * drawn while it leaves, and says so here, so that `LineDetail`'s sheet slides out (or goes back
 * down) before it is taken away.
 */
export const DetailClosing = createContext(false);

/**
 * Whether the open line's detail came with the page (a line opened from its address) rather than
 * from a press once the page was there: `OperationsLayout` says so, and `LineDetail`'s sheet then
 * shows in its place at once instead of sliding in on its own.
 */
export const DetailCameWithPage = createContext(false);

/** What closing the detail's sheet does: the open line's own close. */
export type DetailClose = { onClose: () => void };

/**
 * Where `OperationsLayout` holds the open line's detail in one sheet that stays open from one line
 * to the next (#164: a sheet put up again would land over a dialog opened since), on every screen
 * (#182): `LineDetail` draws the sheet's head and body (`SheetHeader`, `SheetBody`), the server's
 * page too, and says here what closing it does. Elsewhere, nothing.
 */
export const DetailSheetClose = createContext<((close: DetailClose) => void) | undefined>(
  undefined,
);
