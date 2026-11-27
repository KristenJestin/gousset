-- A line's receipts (#217) kept apart as every user's table is (docs/data-model.md, "Ownership and
-- isolation"): row-level security forced, so that the policy binds the tables' owner too, and the
-- grant to `gousset_user` alone, never to `gousset_app`. Its keys, composite on `user_id` and
-- `on delete cascade`, and its policy are Drizzle's, in `*_line_attachment`. Each statement does
-- nothing more the second time.
GRANT SELECT, INSERT, UPDATE, DELETE ON "line_attachment" TO gousset_user;--> statement-breakpoint
ALTER TABLE "line_attachment" FORCE ROW LEVEL SECURITY;
