import type {
  AccountStore,
  CategoryStore,
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Ledger,
  LineStore,
  Merchants,
  Transfers,
} from "@gousset/core";

import { INSTRUCTIONS } from "./instructions";
import type { ServerDefinition } from "./server";
import type { Tool } from "./tool";
import { accountsTool } from "./tools/accounts";
import { categoriesTool } from "./tools/categories";
import { dataTool } from "./tools/data";
import { importsTool } from "./tools/imports";
import { linesTool } from "./tools/lines";
import { merchantsTool } from "./tools/merchants";
import { monthTool } from "./tools/month";

/**
 * The services Gousset's tools need (the made-up month, the user's accounts, the imports and their
 * profiles, the export, every line searched across accounts, the transfers between accounts, the
 * merchants, the categories, the expenses made of several lines).
 */
export type GoussetServices =
  | Ledger
  | AccountStore
  | Imports
  | ImportProfiles
  | DataExport
  | LineStore
  | Transfers
  | Merchants
  | CategoryStore
  | Expenses;

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
  categoriesTool,
];

export const goussetServer: ServerDefinition<GoussetServices> = {
  tools: goussetTools,
  instructions: INSTRUCTIONS,
  version: "0.1.0",
};
