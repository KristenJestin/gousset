// The `migrate` one-shot of the image (docs/releases.md, "Installing"): applies Drizzle's
// migrations to DATABASE_URL, then exits, so that the app starts only on an up-to-date schema.
// Bundled into one file at the image's build; the migrations sit beside it, as they do here.
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.DATABASE_URL;

if (!url) {
  process.stderr.write("migrate: DATABASE_URL is not set (or DATABASE_URL_FILE names no file).\n");
  process.exit(1);
}

const db = drizzle(url);

try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("migrations", import.meta.url)) });
  process.stdout.write("migrate: the database is up to date.\n");
} finally {
  await db.$client.end();
}
