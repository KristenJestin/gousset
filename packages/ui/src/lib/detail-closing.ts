import { createContext } from "react";

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
