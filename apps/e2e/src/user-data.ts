import { appConnection } from "@gousset/db/app-role";
import type { APP_ROLE } from "@gousset/db/app-role";
import { relations } from "@gousset/db/relations";
import { randomUUID } from "node:crypto";

import { authOauthClient, authOauthConsent, authUser } from "@gousset/db/schema/auth";
import { importProfile, importUpload, merchant, rule } from "@gousset/db/schema/ledger";
import { recogniseMerchants } from "@gousset/core";
import { seedMadeUpData } from "@gousset/db/seed";
import type { SeedSummary } from "@gousset/db/seed";
import { UserData, userDataLayer } from "@gousset/db/user-data";
import type { QueryFailed, USER_ROLE, UserTransaction } from "@gousset/db/user-data";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Option, Schema } from "effect";

import { databaseUrl } from "./database";

/** A table holding a user's rows, the column that names a row, and what the rows are called. */
export type UserTable = { name: string; key: string; rows: string };

/**
 * Every table holding a user's rows (docs/data-model.md, v0.2, v0.3 and v0.6). A table added later must be listed
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
  { name: "import_upload", key: "id", rows: "file uploads" },
  { name: "category", key: "id", rows: "categories" },
  { name: "entry", key: "id", rows: "entries" },
  { name: "entry_part", key: "id", rows: "entry parts" },
  { name: "transfer", key: "id", rows: "transfers" },
  { name: "merchant", key: "id", rows: "merchants" },
  { name: "merchant_alias", key: "id", rows: "merchants' cleaned labels" },
  { name: "rule", key: "id", rows: "rules" },
  { name: "security", key: "id", rows: "securities" },
  { name: "investment_operation", key: "id", rows: "investment operations" },
];

/**
 * The user tables an export leaves out, and why: a file upload is a file on its way in, deleted
 * once imported and within minutes otherwise (#129); its import, once made, is exported.
 */
export const NOT_EXPORTED: ReadonlySet<string> = new Set(["import_upload"]);

/** The client the seeded file uploads' grant is for: no test authorizes it, none revokes it. */
const SEED_CLIENT_ID = "gousset-e2e-seed";

/**
 * Every table of the `public` schema the app's own role reaches, outside a user's transaction: what
 * is not one user's data. better-auth's tables (the users, their sessions, the MCP door's clients
 * and tokens), read and written by better-auth for every user, and the installation's settings. A
 * table added later that the app's role reaches must be listed here, or the isolation spec fails.
 * pg-boss's tables, in a schema of their own (`pgboss`), belong to the app's role.
 */
export const SHARED_TABLES: ReadonlyArray<string> = [
  "auth_account",
  "auth_jwks",
  "auth_oauth_access_token",
  "auth_oauth_client",
  "auth_oauth_client_assertion",
  "auth_oauth_client_resource",
  "auth_oauth_consent",
  "auth_oauth_refresh_token",
  "auth_oauth_resource",
  "auth_session",
  "auth_user",
  "auth_verification",
  "installation_settings",
];

/** The schema pg-boss keeps its tables in (apps/web/src/jobs/queue.server.ts). */
export const JOBS_SCHEMA = "pgboss";

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

/**
 * The keys of the rows of `table` a transaction sees, among `among` when given, in order; on the
 * app's own handle too, which a user's tables refuse.
 */
export async function keysOf(
  transaction: Pick<UserTransaction, "execute">,
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

/** The code `attempt` raises to undo a write that Postgres accepted. */
const ROLLED_BACK = "GSRBK";

// Drizzle wraps the driver's error, keeping it as the cause.
const SqlState = Schema.Struct({ code: Schema.String });

const sqlState = Schema.decodeUnknownOption(
  Schema.Union([SqlState, Schema.Struct({ cause: SqlState })]),
);

/** Postgres's code for a failed query, or `UNKNOWN`. */
function codeOf(error: Error): string {
  return Option.match(sqlState(error), {
    onNone: () => "UNKNOWN",
    onSome: (state) => ("cause" in state ? state.cause.code : state.code),
  });
}

const Session = Schema.Struct({
  rows: Schema.Array(Schema.Struct({ role: Schema.String, owner: Schema.String })),
});

const UserRole = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      superuser: Schema.Boolean,
      bypassesRowSecurity: Schema.Boolean,
      logsIn: Schema.Boolean,
    }),
  ),
});

const AppRole = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      superuser: Schema.Boolean,
      bypassesRowSecurity: Schema.Boolean,
      ownsTables: Schema.Boolean,
    }),
  ),
});

const Isolation = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      rowSecurity: Schema.Boolean,
      forced: Schema.Boolean,
      ownerPolicy: Schema.Boolean,
      granted: Schema.Boolean,
    }),
  ),
});

/**
 * A worker's database reached as the app reaches it: the role it logs in with, and `UserData` for a
 * user's rows. One connection, so that what a transaction leaves on it is what the next one meets.
 * The catalog is read apart, as the harness's own role, which sees every table.
 */
export function openUserData(database: string) {
  const db = drizzle({
    connection: { ...appConnection(databaseUrl(database)), max: 1 },
    relations,
  });

  const catalog = drizzle({ connection: { connectionString: databaseUrl(database), max: 1 } });

  const layer = userDataLayer(db);

  const transaction = <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
    Effect.gen(function* () {
      const userData = yield* UserData;

      return yield* userData.transaction(owner, work);
    }).pipe(Effect.provide(layer));

  return {
    /** `UserData` on this database, for the packages' own logic (`@gousset/core`) to run on. */
    layer,

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

    /**
     * Postgres's code when it refuses `work`, or `accepted`; either way the transaction is rolled
     * back, so that a rule is tried again and again on the same rows.
     */
    attempt: <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
      Effect.runPromise(
        transaction(owner, async (each) => {
          await work(each);
          await each.execute(
            sql`do $$ begin raise exception 'rolled back' using errcode = 'GSRBK'; end $$`,
          );
        }).pipe(
          Effect.match({
            onSuccess: () => "accepted",
            onFailure: (failure: QueryFailed) =>
              failure.code === ROLLED_BACK ? "accepted" : failure.code,
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

    /** Whether the default categories of the user of this e-mail are marked as in their language. */
    async defaultsSettled(email: string): Promise<boolean | undefined> {
      const [found] = await db
        .select({ settled: authUser.defaultCategoriesSettled })
        .from(authUser)
        .where(eq(authUser.email, email));

      return found?.settled;
    },

    /**
     * The made-up data of two months, and a CSV profile, as `owner`'s rows, with the merchants of its
     * lines recognised as the app does at boot (the seed writes lines, not merchants). A user who
     * already has accounts is left as they are, profile included.
     */
    seed: (owner: string): Promise<SeedSummary> =>
      Effect.runPromise(
        seedMadeUpData(owner, ["2026-09", "2026-10"], "2026-10-31").pipe(
          Effect.tap((seeded) =>
            Effect.gen(function* () {
              if (seeded.accounts === 0) {
                return;
              }

              const userData = yield* UserData;

              yield* userData.transaction(owner, (each) =>
                each.insert(importProfile).values({
                  userId: owner,
                  name: "Riverside Bank CSV",
                  institution: "Riverside Bank",
                  definition: { version: 1 },
                }),
              );

              yield* recogniseMerchants(owner);

              // A rule of the user's (#25), naming one of their merchants, so that every table
              // holds a row of theirs.
              yield* userData.transaction(owner, async (each) => {
                const [shop] = await each.select({ id: merchant.id }).from(merchant).limit(1);

                await each.insert(rule).values({
                  userId: owner,
                  conditions: {
                    kind: "group",
                    combinator: "and",
                    children: [
                      { kind: "rule", field: "label", operator: "contains", value: "MADE-UP" },
                    ],
                  },
                  setMerchantId: shop?.id ?? null,
                  createdFrom: "user",
                });
              });
            }),
          ),
          Effect.provide(layer),
        ),
      ),

    /**
     * A file upload of `owner`'s, far from its expiry, for a grant of a client of its own, unless
     * they have one already. The grant is listed among the user's connected clients: a spec that
     * seeds it forgets it when it ends (`forgetFileUploads`), so that other specs of the worker
     * see the user's clients as they left them.
     */
    seedFileUpload: async (owner: string): Promise<void> => {
      const uploads = await Effect.runPromise(
        transaction(owner, (each) => each.select({ id: importUpload.id }).from(importUpload)),
      );

      if (uploads.length > 0) {
        return;
      }

      const now = new Date();
      const grantId = randomUUID();

      await db
        .insert(authOauthClient)
        .values({
          id: randomUUID(),
          clientId: SEED_CLIENT_ID,
          name: "Seeded uploads",
          redirectUris: ["http://127.0.0.1:47213/seed/callback"],
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: authOauthClient.clientId });

      await db.insert(authOauthConsent).values({
        id: grantId,
        clientId: SEED_CLIENT_ID,
        userId: owner,
        scopes: ["read", "write"],
        createdAt: now,
        updatedAt: now,
      });

      await Effect.runPromise(
        transaction(owner, (each) =>
          each.insert(importUpload).values({
            userId: owner,
            grantId,
            secretSha256: "0".repeat(64),
            fileName: "seeded.ofx",
            size: 1,
            parts: 1,
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          }),
        ),
      );
    },

    /** Forgets the grant `seedFileUpload` made for `owner`, and its file uploads with it. */
    forgetFileUploads: async (owner: string): Promise<void> => {
      await db
        .delete(authOauthConsent)
        .where(
          and(eq(authOauthConsent.userId, owner), eq(authOauthConsent.clientId, SEED_CLIENT_ID)),
        );
    },

    /**
     * Postgres's code when it refuses `work` run on the app's own handle, outside any user's
     * transaction, or `accepted`.
     */
    outside: async <A>(work: (app: typeof db) => Promise<A>): Promise<string> => {
      try {
        await work(db);

        return "accepted";
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }

        return codeOf(error);
      }
    },

    /** The role the app logs in with, and what it may do beyond its grants. */
    async appRole() {
      const result = await db.execute(sql`
        select r.rolname::text as role, r.rolsuper as "superuser",
          r.rolbypassrls as "bypassesRowSecurity",
          exists (
            select 1 from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relowner = r.oid
          ) as "ownsTables"
        from pg_roles r where r.rolname = current_user`);

      return Schema.decodeUnknownSync(AppRole)(result).rows;
    },

    /**
     * Every table, view or sequence of the database `role` holds any privilege on, its own or a
     * column's, as `schema.name`: what it reaches, whatever the table holds.
     */
    async reachableTables(
      role: typeof APP_ROLE | typeof USER_ROLE,
    ): Promise<ReadonlyArray<string>> {
      const result = await catalog.execute(sql`
        select format('%s.%s', n.nspname, c.relname) as key
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and (
            has_table_privilege(${role}, c.oid, 'SELECT')
            or has_table_privilege(${role}, c.oid, 'INSERT')
            or has_table_privilege(${role}, c.oid, 'UPDATE')
            or has_table_privilege(${role}, c.oid, 'DELETE')
            or has_table_privilege(${role}, c.oid, 'TRUNCATE')
            or has_table_privilege(${role}, c.oid, 'REFERENCES')
            or has_table_privilege(${role}, c.oid, 'TRIGGER')
            or (c.relkind <> 'S' and has_any_column_privilege(${role}, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
          )
        order by 1`);

      return decodeKeys(result).rows.map((row) => row.key);
    },

    /** The role and the user a plain query of the app's meets on the connection. */
    async session() {
      const result = await db.execute(
        sql`select current_user::text as role, coalesce(current_setting('gousset.user_id', true), '') as owner`,
      );

      return Schema.decodeUnknownSync(Session)(result).rows;
    },

    /** Every table of the database's public schema that has a `user_id`, but better-auth's. */
    async tablesWithOwner(): Promise<ReadonlyArray<string>> {
      const result = await catalog.execute(sql`
        select c.table_name::text as key
        from information_schema.columns c
        join information_schema.tables t using (table_schema, table_name)
        where c.table_schema = 'public' and c.column_name = 'user_id'
          and t.table_type = 'BASE TABLE' and c.table_name not like 'auth\\_%'
        order by 1`);

      return decodeKeys(result).rows.map((row) => row.key);
    },

    /** The columns of a table of the public schema, in their order. */
    async columnsOf(table: string): Promise<ReadonlyArray<string>> {
      const result = await catalog.execute(sql`
        select column_name::text as key from information_schema.columns
        where table_schema = 'public' and table_name = ${table}
        order by ordinal_position`);

      return decodeKeys(result).rows.map((row) => row.key);
    },

    /**
     * Deletes a user as the harness's own role, the tables' owner: Gousset has no route for it, and
     * the deletion cascades into every table of theirs, as docs/data-model.md says it must.
     */
    async deleteUser(id: string): Promise<void> {
      await catalog.delete(authUser).where(eq(authUser.id, id));
    },

    /** What `gousset_user` may do beyond its grants: nothing, or row-level security means nothing. */
    async userRole() {
      const result = await catalog.execute(sql`
        select rolsuper as "superuser", rolbypassrls as "bypassesRowSecurity", rolcanlogin as "logsIn"
        from pg_roles where rolname = 'gousset_user'`);

      return Schema.decodeUnknownSync(UserRole)(result).rows;
    },

    /**
     * Whether a table has row-level security on, forced on its owner too, the owner's policy, and
     * `gousset_user`'s grants.
     */
    async isolationOf(table: string) {
      const result = await catalog.execute(sql`
        select
          c.relrowsecurity as "rowSecurity",
          c.relforcerowsecurity as "forced",
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

    close: async () => {
      await db.$client.end();
      await catalog.$client.end();
    },
  };
}
