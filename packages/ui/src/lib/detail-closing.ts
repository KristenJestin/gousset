import { createContext } from "react";

/**
 * Whether the open line's detail is on its way out: `OperationsLayout` keeps a closed detail
 * drawn while it leaves, and says so here, so that `LineDetail` fades its content out (or lets
 * its sheet go back down) before it is taken away.
 */
export const DetailClosing = createContext(false);
