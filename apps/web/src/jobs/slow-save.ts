import { Schema } from "effect";

// What an import's save says once it lasts (#241): which of the database's connections it holds,
// what each waits on and who blocks it, and the pool's counts, so that a save that stalls names
// its cause in the app's log. Ids, counts, wait names and queries' shapes only, never what a file
// holds: the log keeps strings as they are.

/** How long an import's save runs before it says what its connections wait on. */
export const SLOW_SAVE_MS = 20_000;

/** How much of a query's text a line keeps. */
const QUERY_KEPT = 200;

/** A connection of the app's database as `pg_stat_activity` shows it to the app's role. */
export const Activity = Schema.Struct({
  pid: Schema.Number,
  state: Schema.NullOr(Schema.String),
  wait_event_type: Schema.NullOr(Schema.String),
  wait_event: Schema.NullOr(Schema.String),
  application_name: Schema.NullOr(Schema.String),
  transaction_seconds: Schema.NullOr(Schema.Number),
  blocked_by: Schema.Array(Schema.Number),
  query: Schema.NullOr(Schema.String),
});

export type Activity = typeof Activity.Type;

/** The pool the app's queries take their connections from. */
export type PoolCounts = {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
};

/**
 * A query's text with every string and number written over (a `$1` parameter stays), on one line,
 * cut to `QUERY_KEPT`. Gousset's queries pass their values as parameters; a value written into a
 * query's text would still not reach the log.
 */
export function queryWithoutValues(query: string | null): string {
  if (query === null) {
    return "none";
  }

  const written = query
    .replaceAll(/'(?:[^']|'')*'/g, "'…'")
    .replaceAll(/(?<![$\w])\d+(?:\.\d+)?/g, "…")
    .replaceAll(/\s+/g, " ")
    .trim();

  return written.length > QUERY_KEPT ? `${written.slice(0, QUERY_KEPT - 1)}…` : written;
}

const connectionLine = (kind: string, activity: Activity, extra: string) =>
  [
    `${kind} pid=${activity.pid}`,
    `state=${activity.state ?? "none"}`,
    `wait=${activity.wait_event_type ?? "none"}/${activity.wait_event ?? "none"}`,
    `transaction=${activity.transaction_seconds === null ? "none" : `${activity.transaction_seconds}s`}`,
    extra,
    `query="${queryWithoutValues(activity.query)}"`,
  ]
    .filter((part) => part !== "")
    .join(" ");

/**
 * The log's lines for an import whose save has run `seconds`: the import's own connections (named
 * `name`, `importConnectionName`) with who blocks each, then the others under way, those that block
 * it first. No connection of its own means it waits outside the database: for the pool, or in its
 * own code.
 */
export function slowSaveLines(
  importId: string,
  name: string,
  seconds: number,
  pool: PoolCounts,
  activities: ReadonlyArray<Activity>,
): ReadonlyArray<string> {
  const own = activities.filter((activity) => activity.application_name === name);
  const blockers = new Set(own.flatMap((activity) => activity.blocked_by));

  const others = activities
    .filter((activity) => activity.application_name !== name)
    .toSorted((a, b) => Number(blockers.has(b.pid)) - Number(blockers.has(a.pid)));

  return [
    `import ${importId}: its save has run ${seconds} s; pool total=${pool.total} idle=${pool.idle} waiting=${pool.waiting}`,
    ...(own.length === 0
      ? ["import connection: none open, so it waits outside the database (the pool, or its code)"]
      : own.map((activity) =>
          connectionLine(
            "import connection",
            activity,
            `blocked_by=${activity.blocked_by.length === 0 ? "none" : activity.blocked_by.join(",")}`,
          ),
        )),
    ...others.map((activity) =>
      connectionLine(
        "other connection",
        activity,
        `app=${activity.application_name === null || activity.application_name === "" ? "none" : activity.application_name} blocks_import=${blockers.has(activity.pid) ? "yes" : "no"}`,
      ),
    ),
  ];
}
