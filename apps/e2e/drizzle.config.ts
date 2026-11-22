import { defineConfig } from "drizzle-kit";

// Gousset's migrations, applied by the harness to its template database. The URL comes from the
// environment the harness gives drizzle-kit (src/database.ts), never from its command line.
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema",
  out: "../../packages/db/src/migrations",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.E2E_SCHEMA_URL ?? "" },
});
