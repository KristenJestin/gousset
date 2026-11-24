-- The rules (#25) kept apart as every user's table is (docs/data-model.md, "Ownership and
-- isolation"): row-level security forced, so that the policy binds the table's owner too, and the
-- grants to `gousset_user` alone, never to `gousset_app`. What a rule sets, and an entry's merchant
-- and rule, are the user's own rows: composite keys on `user_id`, each cleared on its own column
-- when the row it names is deleted (`on delete set null (<column>)`, Postgres 15 and later), which
-- never touches `user_id`. Drizzle cannot write them. Each statement does nothing more the second
-- time.
ALTER TABLE "rule" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "rule" TO gousset_user;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "rule" ADD CONSTRAINT "rule_set_merchant_fk" FOREIGN KEY ("user_id","set_merchant_id") REFERENCES "merchant"("user_id","id") ON DELETE SET NULL ("set_merchant_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "rule" ADD CONSTRAINT "rule_set_category_fk" FOREIGN KEY ("user_id","set_category_id") REFERENCES "category"("user_id","id") ON DELETE SET NULL ("set_category_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "entry" ADD CONSTRAINT "entry_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "merchant"("user_id","id") ON DELETE SET NULL ("merchant_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "entry" ADD CONSTRAINT "entry_rule_fk" FOREIGN KEY ("user_id","rule_id") REFERENCES "rule"("user_id","id") ON DELETE SET NULL ("rule_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
