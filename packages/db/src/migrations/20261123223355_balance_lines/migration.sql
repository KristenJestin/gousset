ALTER TABLE "account" ADD COLUMN "balance_category_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_line" ADD COLUMN "balance_id" uuid;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_user_id_id_key" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_balance_id_key" UNIQUE("balance_id");--> statement-breakpoint
CREATE INDEX "account_balance_category_id_idx" ON "account" ("balance_category_id");--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_balance_fk" FOREIGN KEY ("user_id","balance_id") REFERENCES "account_balance"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_balance_has_balance" CHECK (("source" = 'balance') = ("balance_id" is not null));