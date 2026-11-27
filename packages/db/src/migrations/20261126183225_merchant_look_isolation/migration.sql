-- The merchants' logos (#204) kept apart as every user's table is (docs/data-model.md, "Ownership
-- and isolation"): row-level security forced, so that the policy binds the table's owner too, and
-- the grants to `gousset_user` alone, never to `gousset_app`. Each statement does nothing more the
-- second time.
ALTER TABLE "merchant_logo" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant_logo" TO gousset_user;
