-- A subject's payback lines (#217) kept apart as every user's table is (docs/data-model.md,
-- "Ownership and isolation"): row-level security forced, so that the policy binds the tables' owner
-- too, and the grant to `gousset_user` alone, never to `gousset_app`. Its keys, composite on
-- `user_id` and `on delete cascade`, and its policy are Drizzle's, in `*_subject_payback`. Each
-- statement does nothing more the second time.
GRANT SELECT, INSERT, UPDATE, DELETE ON "subject_payback" TO gousset_user;--> statement-breakpoint
ALTER TABLE "subject_payback" FORCE ROW LEVEL SECURITY;
