import type {
  AccountStore,
  DataExport,
  ImportProfiles,
  Imports,
  Ledger,
  LineStore,
  Merchants,
} from "@gousset/core";

import { INSTRUCTIONS } from "./instructions";
import type { ServerDefinition } from "./server";
import type { Tool } from "./tool";
import { accountsTool } from "./tools/accounts";
import { dataTool } from "./tools/data";
import { importsTool } from "./tools/imports";
import { linesTool } from "./tools/lines";
import { merchantsTool } from "./tools/merchants";
import { monthTool } from "./tools/month";

/**
 * The services Gousset's tools need (the made-up month, the user's accounts, the imports and their
 * profiles, the export, every line searched across accounts, the merchants).
 */
export type GoussetServices =
  | Ledger
  | AccountStore
  | Imports
  | ImportProfiles
  | DataExport
  | LineStore
  | Merchants;

/**
 * Gousset's tools, in the order `tools/list` gives them: one family per concept
 * (docs/mcp.md, rule 7). A new family goes at the end, so that the order clients cache stays.
 */
export const goussetTools: ReadonlyArray<Tool<GoussetServices>> = [
  monthTool,
  importsTool,
  accountsTool,
  dataTool,
  linesTool,
  merchantsTool,
];

export const goussetServer: ServerDefinition<GoussetServices> = {
  tools: goussetTools,
  instructions: INSTRUCTIONS,
  version: "0.1.0",
};
