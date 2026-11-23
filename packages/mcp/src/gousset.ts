import type { ImportProfiles, Imports, Ledger } from "@gousset/core";

import { INSTRUCTIONS } from "./instructions";
import type { ServerDefinition } from "./server";
import type { Tool } from "./tool";
import { importsTool } from "./tools/imports";
import { monthTool } from "./tools/month";

/** The services Gousset's tools need: the app's runner provides them. */
export type GoussetServices = Ledger | Imports | ImportProfiles;

/**
 * Gousset's tools, in the order `tools/list` gives them: one family per concept
 * (docs/mcp.md, rule 7). A new family goes at the end, so that the order clients cache stays.
 */
export const goussetTools: ReadonlyArray<Tool<GoussetServices>> = [monthTool, importsTool];

export const goussetServer: ServerDefinition<GoussetServices> = {
  tools: goussetTools,
  instructions: INSTRUCTIONS,
  version: "0.1.0",
};
