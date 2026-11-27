import { merchantLogo } from "@gousset/db/schema/ledger";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// A merchant's look (#204) is read wherever a merchant is named: its `color` and the SHA-256 of its
// logo, which `lookOf` (`../look`) makes one `Look`.

/** The SHA-256 of the logo of the merchant whose id is the column `id`; null for none. */
export const logoShaOf = (id: PgColumn) =>
  sql<
    string | null
  >`(select ${merchantLogo.sha256} from ${merchantLogo} where ${merchantLogo.merchantId} = ${id})`;
