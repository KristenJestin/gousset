-- The merchants' tables (#24) kept apart as every user's table is (docs/data-model.md, "Ownership
-- and isolation"): row-level security forced, so that the policies bind the tables' owner too, and
-- the grants to `gousset_user` alone, never to `gousset_app`. Each statement does nothing more the
-- second time.
ALTER TABLE "merchant" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_alias" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant", "merchant_alias" TO gousset_user;
