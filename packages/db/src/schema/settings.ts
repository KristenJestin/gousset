import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * The installation's own settings, which the administrator changes: one row at most. With no row
 * yet, every setting has its default.
 */
export const installationSettings = pgTable(
  "installation_settings",
  {
    id: integer("id").primaryKey().default(1),
    // The MCP door (docs/mcp.md): open by default, closed for every user at once when turned off.
    mcpEnabled: boolean("mcp_enabled").default(true).notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [check("installation_settings_single_row", sql`${table.id} = 1`)],
);
