ALTER TABLE "account" ADD COLUMN "balance_category_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_line" ADD COLUMN "balance_id" uuid;--> statement-breakpoint
CREATE INDEX "account_balance_category_id_idx" ON "account" ("balance_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_line_balance_id_key" ON "statement_line" ("balance_id");
