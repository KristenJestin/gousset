import type { BrokerLayout } from "../operations-profile";
import { isBrokerHeader } from "./columns";
import type { BrokerColumns } from "./columns";
import { DEGIRO_COLUMNS } from "./degiro";
import { FORTUNEO_COLUMNS } from "./fortuneo";

// The brokers whose exports are read with their columns found by their names, by layout. Adding a
// broker is a module of its own beside these, and a line here (README, "How to add a broker").

export const BROKERS = {
  fortuneo: FORTUNEO_COLUMNS,
  "degiro-transactions": DEGIRO_COLUMNS,
} satisfies { readonly [layout in BrokerLayout]: BrokerColumns };

/** Whether a header (normalised: lower case, `;` between its cells) is the broker's export. */
export function isLayoutHeader(layout: BrokerLayout, header: string): boolean {
  return isBrokerHeader(BROKERS[layout], header);
}
