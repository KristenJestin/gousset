-- The expense a works council refund funds (#29) is one of the user's own entries: a composite key on
-- (user_id, funds_entry_id), cleared on its own column when the entry is deleted (`on delete set null
-- (funds_entry_id)`, Postgres 15 and later), which never touches `user_id` and leaves the transfer
-- (docs/data-model.md, "Conventions"). Drizzle cannot write it. Added only when missing, so that
-- running this again changes nothing.
DO $$
BEGIN
  ALTER TABLE "transfer" ADD CONSTRAINT "transfer_funds_entry_fk" FOREIGN KEY ("user_id","funds_entry_id") REFERENCES "entry"("user_id","id") ON DELETE SET NULL ("funds_entry_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
