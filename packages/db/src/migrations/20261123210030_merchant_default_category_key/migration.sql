-- A merchant's default category (#23, landed after #24) is one of the user's own categories: a
-- composite key on (user_id, default_category_id), cleared on its own column when the category is
-- deleted (`on delete set null (default_category_id)`, Postgres 15 and later), which never touches
-- `user_id` (docs/data-model.md, "Conventions"). Drizzle cannot write it. Added only when missing,
-- so that running this again changes nothing.
DO $$
BEGIN
  ALTER TABLE "merchant" ADD CONSTRAINT "merchant_default_category_fk" FOREIGN KEY ("user_id","default_category_id") REFERENCES "category"("user_id","id") ON DELETE SET NULL ("default_category_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
