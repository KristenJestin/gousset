-- The category an account kept by its balance sends its movement to (#31) is one of the user's own
-- categories: a composite key on (user_id, balance_category_id), cleared on its own column when the
-- category is deleted (`on delete set null (balance_category_id)`, Postgres 15 and later), which
-- never touches `user_id` (docs/data-model.md, "Conventions"). Drizzle cannot write it. Added only
-- when missing, so that running this again changes nothing.
DO $$
BEGIN
  ALTER TABLE "account" ADD CONSTRAINT "account_balance_category_fk" FOREIGN KEY ("user_id","balance_category_id") REFERENCES "category"("user_id","id") ON DELETE SET NULL ("balance_category_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
