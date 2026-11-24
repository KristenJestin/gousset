import { createContext } from "react";

import type { Money } from "./money";

/**
 * Whether the open line's detail is on its way out: `OperationsLayout` keeps a closed detail
 * drawn while it leaves, and says so here, so that `LineDetail` fades its content out (or lets
 * its sheet go back down) before it is taken away.
 */
export const DetailClosing = createContext(false);

/**
 * Whether the open line's detail came with the page (a line opened from its address) rather than
 * from a press once the page was there: `OperationsLayout` says so, and `LineDetail`'s sheet then
 * shows in its place at once instead of rising on its own.
 */
export const DetailCameWithPage = createContext(false);

/** What the detail's sheet shows at its top, and what its close does: the open line's. */
export type DetailHead = {
  title: string;
  amount: Money;
  locale: string;
  onClose: () => void;
};

/**
 * Below `lg`, where `OperationsLayout` holds the open line's detail in one sheet that stays open
 * from one line to the next (#164: a sheet put up again would land over a dialog opened since):
 * `LineDetail` says its head here and draws its content alone. Elsewhere, nothing.
 */
export const DetailSheetHead = createContext<((head: DetailHead) => void) | undefined>(undefined);
