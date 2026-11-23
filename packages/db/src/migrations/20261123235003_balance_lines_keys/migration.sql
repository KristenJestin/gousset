-- An account kept by its balance (#31; docs/data-model.md, v0.3, "Balance mode"): every noted
-- balance makes one line (`source = balance`) that goes with it, and the account's movement goes to
-- one of the user's own categories. Each key is composite on `user_id`, so that a row only ever
-- points to a row of the same user (docs/data-model.md, "Ownership and isolation"). Drizzle writes
-- none of them here; each is added only when missing, so that running this again changes nothing.

-- What a line made from a noted balance points to.
DO $$
BEGIN
  ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_user_id_id_key" UNIQUE ("user_id","id");
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;--> statement-breakpoint

-- The line goes with its noted balance.
DO $$
BEGIN
  ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_balance_fk" FOREIGN KEY ("user_id","balance_id") REFERENCES "account_balance"("user_id","id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

-- A line made from a noted balance has one, and no other line has any.
DO $$
BEGIN
  ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_balance_has_balance" CHECK (("source" = 'balance') = ("balance_id" is not null));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

-- The category is cleared on its own column when it is deleted (`on delete set null
-- (balance_category_id)`, Postgres 15 and later), which never touches `user_id`
-- (docs/data-model.md, "Conventions").
DO $$
BEGIN
  ALTER TABLE "account" ADD CONSTRAINT "account_balance_category_fk" FOREIGN KEY ("user_id","balance_category_id") REFERENCES "category"("user_id","id") ON DELETE SET NULL ("balance_category_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
