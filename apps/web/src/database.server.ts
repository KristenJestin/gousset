import { createDb } from "@gousset/db";
import { userDataLayer } from "@gousset/db/user-data";

import { ENV } from "./env.server";

/** The app's database, one pool for the process: server functions, the MCP door and the jobs. */
export const db = createDb(ENV);

/** The one door to a user's tables (docs/data-model.md, "Ownership and isolation"). */
export const userData = userDataLayer(db);
