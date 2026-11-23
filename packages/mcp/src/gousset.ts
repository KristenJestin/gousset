import type { AccountStore, Ledger } from "@gousset/core";

import { INSTRUCTIONS } from "./instructions";
import type { ServerDefinition } from "./server";
import type { Tool } from "./tool";
import { accountsTool } from "./tools/accounts";
import { monthTool } from "./tools/month";

/** What Gousset's tools need: the made-up month (v0.1) and the user's accounts. */
export type GoussetServices = Ledger | AccountStore;

/**
 * Gousset's tools, in the order `tools/list` gives them: one family per concept
 * (docs/mcp.md, rule 7). A new family goes at the end, so that the order clients cache stays.
 */
export const goussetTools: ReadonlyArray<Tool<GoussetServices>> = [monthTool, accountsTool];

export const goussetServer: ServerDefinition<GoussetServices> = {
  tools: goussetTools,
  instructions: INSTRUCTIONS,
  version: "0.1.0",
};
