// The `migrate` one-shot of the image (docs/releases.md, "Installing"): applies Drizzle's
// migrations to DATABASE_URL, as the tables' owner, then lets the app's role log in (#66), and
// exits, so that the app starts only on an up-to-date schema. Bundled into one file at the image's
// build; the migrations sit beside it, as they do here. `pnpm db:migrate` names its folder.
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { APP_ROLE, appLoginStatement } from "./app-role";

const url = process.env.DATABASE_URL;

if (!url) {
  process.stderr.write("migrate: DATABASE_URL is not set (or DATABASE_URL_FILE names no file).\n");
  process.exit(1);
}

if (decodeURIComponent(new URL(url).username) === APP_ROLE) {
  process.stderr.write(
    `migrate: DATABASE_URL names ${APP_ROLE}, the app's role: migrations run as the tables' owner.\n`,
  );
  process.exit(1);
}

const migrationsFolder = process.argv[2] ?? fileURLToPath(new URL("migrations", import.meta.url));
const db = drizzle(url);

try {
  await migrate(db, { migrationsFolder });
  await db.$client.query(appLoginStatement(url));
  process.stdout.write("migrate: the database is up to date.\n");
} finally {
  await db.$client.end();
}
