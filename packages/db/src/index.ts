import { drizzle } from "drizzle-orm/node-postgres";

import { appDatabaseUrl } from "./app-role";
import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

/** The app's database, logged in as its own role (`app-role.ts`), whichever URL it is given. */
export function createDb(env: DatabaseConfig) {
  return drizzle(appDatabaseUrl(env.DATABASE_URL), { relations });
}

export type Database = ReturnType<typeof createDb>;
