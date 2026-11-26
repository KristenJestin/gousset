import type {
  AccountStore,
  CategoryStore,
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  LineStore,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
} from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";

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
import { reviewTool } from "./tools/review";
import { rulesTool } from "./tools/rules";
import { subjectsTool } from "./tools/subjects";

/**
 * The services Gousset's tools need (the user's accounts, the imports and their profiles, the
 * export, every line searched across accounts, the transfers between accounts, the merchants, the
 * categories, the rules' database and job, the expenses made of several lines, the charges
 * subscriptions are detected from, and the rows of a month).
 */
export type GoussetServices =
  | AccountStore
  | Imports
  | ImportProfiles
  | DataExport
  | LineStore
  | Transfers
  | Merchants
  | CategoryStore
  | UserData
  | RuleJobs
  | Expenses
  | Subscriptions
  | MonthFacts;

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
  rulesTool,
  reviewTool,
  subjectsTool,
];

export const goussetServer: ServerDefinition<GoussetServices> = {
  tools: goussetTools,
  instructions: INSTRUCTIONS,
  version: "0.1.0",
};
