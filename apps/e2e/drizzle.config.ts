import { defineConfig } from "drizzle-kit";

// Gousset's schema, pushed by the harness into its template database. The URL comes from the
// environment the harness gives drizzle-kit (src/database.ts), never from its command line.
export default defineConfig({
  dialect: "postgresql",
  schema: "../../packages/db/src/schema",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.E2E_SCHEMA_URL ?? "" },
});
