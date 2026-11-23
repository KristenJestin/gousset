import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { authUser } from "./auth";
import { statementLine } from "./ledger";

// Money moved between two of the user's own accounts (docs/data-model.md, v0.3, `transfer`; #26):
// two lines, one out and one in, paired as one movement that is never spending. Its row-level
// security is the ledger's (./ledger.ts); its grant to `gousset_user` and the forced policy are in
// its migration, `*_transfers`.

/** Who paired the two sides: the import's pairing, a rule (#25), or the user. */
export const pairedBy = pgEnum("paired_by", ["import", "rule", "user"]);

/** Two lines of the user's, on two accounts, paired as one transfer. */
export const transfer = pgTable.withRLS(
  "transfer",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    // The line money left by, and the line it came in by. A line is the side of one transfer at
    // most: each column is unique, and `packages/core`, which writes every pairing, refuses a line
    // that is already the other side of one (two keys over two columns cannot say it).
    outLineId: uuid("out_line_id").notNull(),
    inLineId: uuid("in_line_id").notNull(),
    pairedBy: pairedBy("paired_by").notNull(),
  },
  (table) => [
    unique("transfer_user_id_id_key").on(table.userId, table.id),
    unique("transfer_out_line_id_key").on(table.outLineId),
    unique("transfer_in_line_id_key").on(table.inLineId),
    // Either side deleted (an import undone, an account deleted), the transfer goes with it.
    foreignKey({
      name: "transfer_out_line_fk",
      columns: [table.userId, table.outLineId],
      foreignColumns: [statementLine.userId, statementLine.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "transfer_in_line_fk",
      columns: [table.userId, table.inLineId],
      foreignColumns: [statementLine.userId, statementLine.id],
    }).onDelete("cascade"),
    check("transfer_two_lines", sql`${table.outLineId} <> ${table.inLineId}`),
    pgPolicy("transfer_own_rows_only", {
      as: "permissive",
      for: "all",
      using: sql`"user_id" = current_setting('gousset.user_id', true)`,
      withCheck: sql`"user_id" = current_setting('gousset.user_id', true)`,
    }),
  ],
);
