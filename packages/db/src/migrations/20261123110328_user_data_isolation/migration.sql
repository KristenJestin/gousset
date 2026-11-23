-- Each user's rows kept apart (docs/data-model.md, "Ownership and isolation"). Kept out of the
-- Drizzle schema on purpose: Drizzle writes neither roles' grants nor a foreign key that clears
-- one column of several, and regenerating the schema never drops what is written here.
--
-- A user's transaction (`UserData`, packages/db/src/user-data.ts) acts as `gousset_user`, which
-- row-level security restricts, where the role the app logs in with is not. Roles belong to the
-- whole server, shared by every database (the end-to-end harness clones one per worker, and two
-- runs may migrate at once): the role is made only when missing.
DO $$
BEGIN
  CREATE ROLE gousset_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;--> statement-breakpoint
-- A role of that name made beforehand by someone else is used only if row-level security binds it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'gousset_user' AND (rolsuper OR rolbypassrls OR rolcanlogin)
  ) THEN
    RAISE EXCEPTION 'The role gousset_user exists and is a superuser, bypasses row-level security or logs in: Gousset cannot keep its users apart with it. Make it NOSUPERUSER NOBYPASSRLS NOLOGIN, then migrate again.';
  END IF;
END
$$;--> statement-breakpoint
-- The role the migrations run as is the one the app logs in with: it may switch to gousset_user.
GRANT gousset_user TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO gousset_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account", "account_balance", "statement_line", "import", "import_file", "import_profile" TO gousset_user;--> statement-breakpoint
-- Optional references clear their own column only: `user_id`, shared by both rows, stays.
ALTER TABLE "account" ADD CONSTRAINT "account_settles_into_fk" FOREIGN KEY ("user_id","settles_into_account_id") REFERENCES "account"("user_id","id") ON DELETE SET NULL ("settles_into_account_id");--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_profile_fk" FOREIGN KEY ("user_id","profile_id") REFERENCES "import_profile"("user_id","id") ON DELETE SET NULL ("profile_id");--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_duplicate_of_fk" FOREIGN KEY ("user_id","duplicate_of_line_id") REFERENCES "statement_line"("user_id","id") ON DELETE SET NULL ("duplicate_of_line_id");
