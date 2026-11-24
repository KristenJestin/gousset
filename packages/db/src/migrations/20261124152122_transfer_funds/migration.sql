ALTER TABLE "transfer" ADD COLUMN "funds_entry_id" uuid;--> statement-breakpoint
CREATE INDEX "transfer_funds_entry_id_idx" ON "transfer" ("funds_entry_id");