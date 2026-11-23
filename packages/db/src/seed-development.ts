// `pnpm db:seed`: the development database filled from `packages/fixture`. Every user of the
// database who has no account yet gets the made-up accounts and the six months up to today; sign
// up in the app first. Bundled and run by the script of the same name, never in an installation.
import { Effect } from "effect";

import { createDb } from "./index";
import { authUser } from "./schema/auth";
import { recentMonths, seedMadeUpData } from "./seed";
import { userDataLayer } from "./user-data";

const url = process.env.DATABASE_URL;

if (!url) {
  process.stderr.write("db:seed: DATABASE_URL is not set.\n");
  process.exit(1);
}

const db = createDb({ DATABASE_URL: url });
const today = new Date().toISOString().slice(0, 10);

try {
  // The users themselves are not a user's data: read as the app's own role.
  const users = await db.select({ id: authUser.id }).from(authUser);

  const summaries = await Effect.runPromise(
    Effect.forEach(users, (user) => seedMadeUpData(user.id, recentMonths(today, 6), today)).pipe(
      Effect.provide(userDataLayer(db)),
    ),
  );

  const seeded = summaries.filter((summary) => summary.accounts > 0).length;

  process.stdout.write(
    `db:seed: made-up data written for ${seeded} user(s); ${users.length - seeded} already had accounts.\n`,
  );
} finally {
  await db.$client.end();
}
