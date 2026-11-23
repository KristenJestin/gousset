import { relations } from "@gousset/db/relations";
import { authUser } from "@gousset/db/schema/auth";
import { importProfile } from "@gousset/db/schema/ledger";
import { seedMadeUpData } from "@gousset/db/seed";
import type { SeedSummary } from "@gousset/db/seed";
import { UserData, userDataLayer } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Schema } from "effect";

import { databaseUrl } from "./database";

/** A table holding a user's rows, the column that names a row, and what the rows are called. */
export type UserTable = { name: string; key: string; rows: string };

/**
 * Every table holding a user's rows (docs/data-model.md, v0.2). A table added later must be listed
 * here: the isolation spec fails until it is, then tries every rule on it.
 */
export const ACCOUNTS: UserTable = { name: "account", key: "id", rows: "accounts" };

export const USER_TABLES: ReadonlyArray<UserTable> = [
  ACCOUNTS,
  { name: "account_balance", key: "id", rows: "account balances" },
  { name: "statement_line", key: "id", rows: "statement lines" },
  { name: "import", key: "id", rows: "imports" },
  { name: "import_file", key: "import_id", rows: "imported files" },
  { name: "import_profile", key: "id", rows: "import profiles" },
];

// A raw query's result, decoded: Drizzle types it as one result or several.
const Keys = Schema.Struct({ rows: Schema.Array(Schema.Struct({ key: Schema.String })) });
const decodeKeys = Schema.decodeUnknownSync(Keys);

/**
 * Keys as one Postgres array, for `= any(…)`: Drizzle would spread a JavaScript array into a list
 * of parameters. Keys are uuids, with no comma.
 */
export function keyArray(keys: ReadonlyArray<string>) {
  return sql`string_to_array(${keys.join(",")}, ',')`;
}

/** The keys of the rows of `table` a transaction sees, among `among` when given, in order. */
export async function keysOf(
  transaction: UserTransaction,
  table: UserTable,
  among?: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  const where =
    among === undefined
      ? sql``
      : sql` where ${sql.identifier(table.key)}::text = any(${keyArray(among)})`;

  const result = await transaction.execute(
    sql`select ${sql.identifier(table.key)}::text as key from ${sql.identifier(table.name)}${where} order by 1`,
  );

  return decodeKeys(result).rows.map((row) => row.key);
}

/** Runs a statement that returns the keys of the rows it touched. */
export async function touchedKeys(
  transaction: UserTransaction,
  statement: ReturnType<typeof sql>,
): Promise<ReadonlyArray<string>> {
  const result = await transaction.execute(statement);

  return decodeKeys(result).rows.map((row) => row.key);
}

const Session = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ role: Schema.String, owner: Schema.String })),
});

const Isolation = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      rowSecurity: Schema.Boolean,
      ownerPolicy: Schema.Boolean,
      granted: Schema.Boolean,
    }),
  ),
});

/**
 * A worker's database reached as the app reaches it: the role it logs in with, and `UserData` for a
 * user's rows. One connection, so that what a transaction leaves on it is what the next one meets.
 */
export function openUserData(database: string) {
  const db = drizzle({
    connection: { connectionString: databaseUrl(database), max: 1 },
    relations,
  });

  const layer = userDataLayer(db);

  const transaction = <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
    Effect.gen(function* () {
      const userData = yield* UserData;

      return yield* userData.transaction(owner, work);
    }).pipe(Effect.provide(layer));

  return {
    /** Runs `work` in a transaction of `owner`'s, as every server function does. */
    asUser: <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>): Promise<A> =>
      Effect.runPromise(transaction(owner, work)),

    /** Postgres's code when it refuses `work` (`42501`, `23503`…), or `accepted`. */
    refusal: <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
      Effect.runPromise(
        transaction(owner, work).pipe(
          Effect.match({
            onSuccess: () => "accepted",
            onFailure: (failure: QueryFailed) => failure.code,
          }),
        ),
      ),

    /** The id of the user signed up with this e-mail. */
    async ownerOf(email: string): Promise<string> {
      const [found] = await db
        .select({ id: authUser.id })
        .from(authUser)
        .where(eq(authUser.email, email));

      if (found === undefined) {
        throw new Error(`No user signed up as ${email}.`);
      }

      return found.id;
    },

    /** The made-up data of two months, and a CSV profile, as `owner`'s rows. */
    seed: (owner: string): Promise<SeedSummary> =>
      Effect.runPromise(
        seedMadeUpData(owner, ["2026-09", "2026-10"], "2026-10-31").pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              const userData = yield* UserData;

              yield* userData.transaction(owner, (each) =>
                each.insert(importProfile).values({
                  userId: owner,
                  name: "Riverside Bank CSV",
                  institution: "Riverside Bank",
                  definition: { version: 1 },
                }),
              );
            }),
          ),
          Effect.provide(layer),
        ),
      ),

    /** The role and the user a plain query of the app's meets on the connection. */
    async session() {
      const result = await db.execute(
        sql`select current_user::text as role, coalesce(current_setting('gousset.user_id', true), '') as owner`,
      );

      return Schema.decodeUnknownSync(Session)(result).rows;
    },

    /** Every table of the database's public schema that has a `user_id`, but better-auth's. */
    async tablesWithOwner(): Promise<ReadonlyArray<string>> {
      const result = await db.execute(sql`
        select c.table_name::text as key
        from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
        where c.table_schema = 'public' and c.column_name = 'user_id'
          and t.table_type = 'BASE TABLE' and c.table_name not like 'auth\\_%'
        order by 1`);

      return decodeKeys(result).rows.map((row) => row.key);
    },

    /** Whether a table has row-level security on, the owner's policy, and `gousset_user`'s grants. */
    async isolationOf(table: string) {
      const result = await db.execute(sql`
        select
          c.relrowsecurity as "rowSecurity",
          exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = ${table} and p.cmd = 'ALL'
              and p.qual = '(user_id = current_setting(''gousset.user_id''::text, true))'
              and p.with_check = '(user_id = current_setting(''gousset.user_id''::text, true))'
          ) as "ownerPolicy",
          -- Several privileges in one call answer whether any is held: each is asked apart.
          (has_table_privilege('gousset_user', c.oid, 'SELECT')
            and has_table_privilege('gousset_user', c.oid, 'INSERT')
            and has_table_privilege('gousset_user', c.oid, 'UPDATE')
            and has_table_privilege('gousset_user', c.oid, 'DELETE')) as "granted"
        from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relname = ${table}`);

      return Schema.decodeUnknownSync(Isolation)(result).rows;
    },

    close: () => db.$client.end(),
  };
}
