import { importConnectionName } from "@gousset/core";
import { Effect, Schema } from "effect";

import { db } from "../database.server";
import { Activity, SLOW_SAVE_MS, slowSaveLines } from "./slow-save";

const Activities = Schema.Array(Activity);

/**
 * The connections of the app's database under way, and the import's own even idle, as the app's
 * role sees them: another role's show no query. Read as the app's role, outside any user's
 * transaction, which would see none of them.
 */
const ACTIVITY = `
  select pid, state, wait_event_type, wait_event, application_name,
    greatest(floor(extract(epoch from now() - xact_start)), 0)::int as transaction_seconds,
    pg_blocking_pids(pid) as blocked_by, query
  from pg_stat_activity
  where datname = current_database()
    and pid <> pg_backend_pid()
    and (state is distinct from 'idle' or application_name = $1)`;

/**
 * Says, in the app's log, what the import's connections wait on now that its save has run
 * `SLOW_SAVE_MS` (#241). Never fails: a reading that fails says so instead.
 */
export const reportSlowSave = (importId: string) => {
  const name = importConnectionName(importId);

  return Effect.tryPromise({
    try: async () => db.$client.query(ACTIVITY, [name]),
    catch: () => "unread",
  }).pipe(
    Effect.flatMap((result) => Schema.decodeUnknownEffect(Activities)(result.rows)),
    Effect.matchEffect({
      onFailure: () =>
        Effect.logWarning(
          `import ${importId}: its save has run ${SLOW_SAVE_MS / 1000} s, and its connections could not be read`,
        ),
      onSuccess: (activities) =>
        Effect.logWarning(
          ...slowSaveLines(
            importId,
            name,
            SLOW_SAVE_MS / 1000,
            {
              total: db.$client.totalCount,
              idle: db.$client.idleCount,
              waiting: db.$client.waitingCount,
            },
            activities,
          ),
        ),
    }),
  );
};
