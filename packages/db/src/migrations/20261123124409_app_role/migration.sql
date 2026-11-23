-- The app logs in as a role of its own, never as the tables' owner (#66; docs/data-model.md,
-- "Ownership and isolation"). The migrations run as the owner (the Postgres image's user in an
-- installation); the app logs in as `gousset_app`, which owns no table, is no superuser and does
-- not bypass row-level security. Outside a user's transaction it reaches only what is no user's
-- data; inside one it acts as `gousset_user`, and `reset role` takes it back to a role that
-- reaches less. `migrate` (packages/db/src/migrate.ts) then lets it log in, with a password
-- derived from the owner's. Kept out of the Drizzle schema on purpose, as #13's grants are.
--
-- Roles belong to the whole server (the end-to-end harness clones one database per worker, and two
-- runs may migrate at once): the role is made only when missing, without the right to log in until
-- `migrate` gives it.
DO $$
BEGIN
  CREATE ROLE gousset_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;--> statement-breakpoint
-- A role of that name made beforehand is used only if row-level security binds it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'gousset_app' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'The role gousset_app exists and is a superuser, bypasses row-level security, creates roles or replicates: Gousset cannot keep its users apart with it. Make it NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION, then migrate again.';
  END IF;

  IF current_user = 'gousset_app' THEN
    RAISE EXCEPTION 'The migrations run as gousset_app, the role the app logs in with: run them as the role that owns the tables.';
  END IF;
END
$$;--> statement-breakpoint
-- It may take on `gousset_user` (`set local role`, UserData) without inheriting its grants: a query
-- of the app's outside a user's transaction meets no grant on a user's table, and fails.
DO $$
BEGIN
  GRANT gousset_user TO gousset_app WITH INHERIT FALSE, SET TRUE;
EXCEPTION
  WHEN unique_violation THEN NULL;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gousset_app;--> statement-breakpoint
-- What is no user's data: better-auth reaches its tables for every user, and the administrator the
-- installation's settings. A user's tables are granted to `gousset_user` alone.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_account", "auth_jwks", "auth_oauth_access_token", "auth_oauth_client", "auth_oauth_client_assertion", "auth_oauth_client_resource", "auth_oauth_consent", "auth_oauth_refresh_token", "auth_oauth_resource", "auth_session", "auth_user", "auth_verification", "installation_settings" TO gousset_app;--> statement-breakpoint
-- The policies bind the tables' owner too, should it be no superuser.
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_file" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_profile" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_line" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- pg-boss's schema (#14) belongs to the app's role: pg-boss installs and migrates its tables, and
-- makes one for each queue, as the role it runs as. A new database gets the schema empty; one where
-- pg-boss ran as the owner before hands everything in it over.
DO $$
DECLARE
  statement text;
BEGIN
  IF to_regnamespace('pgboss') IS NULL THEN
    CREATE SCHEMA pgboss AUTHORIZATION gousset_app;
    RETURN;
  END IF;

  ALTER SCHEMA pgboss OWNER TO gousset_app;

  FOR statement IN
    -- Tables, each partition apart; a sequence that belongs to a column moves with its table.
    SELECT format(
      'ALTER %s %s OWNER TO gousset_app',
      CASE c.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      c.oid::regclass
    )
    FROM pg_class c
    WHERE c.relnamespace = 'pgboss'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND NOT (
        c.relkind = 'S' AND EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i')
        )
      )
    UNION ALL
    SELECT format(
      'ALTER %s %s OWNER TO gousset_app',
      CASE p.prokind WHEN 'a' THEN 'AGGREGATE' WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      p.oid::regprocedure
    )
    FROM pg_proc p
    WHERE p.pronamespace = 'pgboss'::regnamespace
    UNION ALL
    -- Enums, domains and ranges; a table's row type and an array type move with what they are of.
    SELECT format('ALTER TYPE %s OWNER TO gousset_app', t.oid::regtype)
    FROM pg_type t
    WHERE t.typnamespace = 'pgboss'::regnamespace AND t.typtype IN ('e', 'd', 'r')
  LOOP
    EXECUTE statement;
  END LOOP;
END
$$;
